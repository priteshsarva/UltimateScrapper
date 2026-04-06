import express from 'express';
import { dbManager } from '../models/dbManager.js';
import { bulkSafeSyncProducts, BulkProductOutOfStock, getProductBydetails, WP_SITES, deleteProduct, fetchAllMatchingProducts } from "../core/wpBulkSafeSync.js";
import { CLIENT_CONFIGS } from '../config/clients.js';

const router = express.Router();



// No tenantIdentify middleware needed here
router.get('/update-stale-sizes', async (req, res) => {
    try {
        const now = Date.now();
        const cutoff = now - (72 * 60 * 60 * 1000); // 72 hours ago

        console.log('Now:', new Date(now).toISOString());
        console.log('Cutoff:', new Date(cutoff).toISOString());

        // 1. Specifically target the 'shoes' database
        const db = await dbManager.getDb('shoes');

        // 2. Fetch the IDs of the stale products so we can return them in the JSON response
        // Using CAST to safely handle timestamps stored as TEXT or INTEGER
        const selectSQL = `SELECT productId FROM PRODUCTS WHERE CAST(productLastUpdated AS INTEGER) < ? OR sizeName = '[]'`;

        const rows = await new Promise((resolve, reject) => {
            db.all(selectSQL, [cutoff], (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });

        const staleIds = rows.map(r => r.productId);
        console.log(`Found ${staleIds.length} stale products to update in 'shoes' DB`);

        if (staleIds.length === 0) {
            return res.status(200).json({
                message: 'No outdated products found.',
                updatedCount: 0
            });
        }

        // 3. Perform a single bulk UPDATE query (Fast & Native)
        // Added: availability = 0
        const updateSQL = `
            UPDATE PRODUCTS 
            SET sizeName = '[]', 
                availability = 0, 
                productLastUpdated = ? 
            WHERE CAST(productLastUpdated AS INTEGER) < ?
            OR sizeName = '[]'
        `;

        const changes = await new Promise((resolve, reject) => {
            db.run(updateSQL, [now, cutoff], function (err) {
                if (err) return reject(err);
                resolve(this.changes);
            });
        });

        console.log(`Successfully updated ${changes} products in 'shoes' DB`);

        // 4. Send the successful response
        res.status(200).json({
            message: 'Update completed',
            updatedCount: changes,
            totalStale: staleIds.length,
            staleIds: staleIds
        });

    } catch (error) {
        console.error('Update stale sizes error:', error);
        res.status(500).json({
            error: 'Failed to update stale sizes',
            details: error.message
        });
    }
});

// router.get("/getProductBydetails", async (req, res) => {

//     //exaple of calling this
//     ///http://localhost:3002/dev/getProductBydetails?property=productFetchedFrom&value=shoe-house-1&compare=contains



//     try {
//         // Grab property, value, and compare from the URL
//         const { property, value } = req.query;
//         let compare = req.query.compare || '='; // Default to Exact Match

//         // Make it user-friendly: if they type 'contains', change it to SQL 'LIKE'
//         if (compare.toLowerCase() === 'contains') {
//             compare = 'LIKE';
//         }

//         if (!property || !value) {
//             return res.status(400).json({
//                 error: "Please provide 'property' and 'value'. Optional: '&compare=contains'"
//             });
//         }

//         console.log(`🔍 Searching across all sites: [${property}] ${compare}[${value}]`);

//         // 👇 Pass 'compare' into the helper function
//         const fetchPromises = WP_SITES.map(async (site) => {
//             const products = await getProductBydetails(property, value, compare, site);

//             // return {
//             //     siteName: site.name,
//             //     matchCount: products.length,
//             //     products: products.map(p => ({
//             //         id: p.id,
//             //         name: p.name,
//             //         sku: p.sku,
//             //         price: p.price,
//             //         status: p.status,
//             //         permalink: p.permalink
//             //     }))
//             // };

//             return {
//                 siteName: site.name,
//                 matchCount: products.length,
//                 products: products.map(p => ({
//                     ...p
//                 }))
//             };
//         });

//         const allResults = await Promise.all(fetchPromises);

//         res.status(200).json({
//             searchQuery: { property, compareRule: compare, value },
//             totalSitesSearched: WP_SITES.length,
//             results: allResults
//         });

//     } catch (error) {
//         console.error("❌ Error in route:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// });

router.get("/getProductBydetails", async (req, res) => {
    try {
        const { property, value, siteName } = req.query;
        let compare = req.query.compare || '=';
        const shouldDelete = req.query.delete === 'true';

        if (compare.toLowerCase() === 'contains') compare = 'LIKE';

        if (!property || !value) {
            return res.status(400).json({ error: "Please provide 'property' and 'value'." });
        }

        let targetSites = WP_SITES;
        if (siteName) {
            targetSites = WP_SITES.filter(s => s.name.toLowerCase() === siteName.toLowerCase());
            if (targetSites.length === 0) {
                return res.status(404).json({ error: `Site '${siteName}' not found.` });
            }
        }

        console.log(`\n🔍 PHASE 1: Fetching products across ${targetSites.length} site(s)...`);

        // =====================================
        // PHASE 1: FETCH FROM ALL SITES FIRST
        // =====================================
        const fetchPromises = targetSites.map(async (site) => {
            const products = await fetchAllMatchingProducts(property, value, compare, site);
            // 👇 ADDED EXPLICIT LOG HERE so you know if a site found 0 items!
            console.log(`✅ [${site.name}] Found ${products.length} products.`);
            return {
                site,
                products,
                deletedCount: 0,
                deletedIds: []
            };
        });

        // Wait for ALL sites to finish gathering their products
        const sitesData = await Promise.all(fetchPromises);
        console.log(`✅ All products fetched successfully.`);

        // =====================================
        // PHASE 2: DELETE GLOBALLY & SIMULTANEOUSLY
        // =====================================
        if (shouldDelete) {
            console.log(`\n⚠️ WARNING: Deletion mode is ENABLED! Starting synchronized global deletion.`);

            // Find which site has the most products so we know how many batches to run
            const maxProducts = Math.max(...sitesData.map(data => data.products.length), 0);
            const batchSize = 50;

            // Loop through batches globally
            for (let i = 0; i < maxProducts; i += batchSize) {
                console.log(`\n🔥 Deleting Global Batch ${Math.floor(i / batchSize) + 1} simultaneously across all sites...`);

                // Map over every site and fire their deletes at the exact same time
                const globalBatchPromises = sitesData.map(async (data) => {
                    const batch = data.products.slice(i, i + batchSize);

                    if (batch.length > 0) {
                        console.log(`   ->[${data.site.name}] Firing ${batch.length} deletes...`);

                        // Fire up to 50 deletes concurrently for this specific site
                        const deletePromises = batch.map(p => deleteProduct(p.id, data.site));
                        const results = await Promise.all(deletePromises);

                        // Track successes
                        results.forEach((success, index) => {
                            if (success) {
                                data.deletedCount++;
                                data.deletedIds.push(batch[index].id);
                            }
                        });
                    }
                });

                // Wait for ALL sites to finish this specific batch of 50
                await Promise.all(globalBatchPromises);

                // Pause for 1 second to let the MySQL databases on all servers breathe
                console.log(`⏳ Batch complete. Letting servers breathe for 1 second...`);
                // await new Promise(resolve => setTimeout(resolve, 1000));
            }
            console.log(`⏳ Batch complete.`);

        }

        // =====================================
        // PHASE 3: FORMAT AND RETURN RESULTS
        // =====================================
        const allResults = sitesData.map(data => ({
            siteName: data.site.name,
            matchCount: data.products.length,
            deletedCount: data.deletedCount,
            deletedIds: data.deletedIds,
            products: data.products.map(p => ({
                id: p.id,
                name: p.name,
                sku: p.sku,
                price: p.price,
                status: p.status,
                permalink: p.permalink
            }))
        }));

        res.status(200).json({
            searchQuery: { property, compareRule: compare, value },
            action: shouldDelete ? "deleted_simultaneously" : "searched",
            totalSitesProcessed: targetSites.length,
            results: allResults
        });

    } catch (error) {
        console.error("❌ Error in route:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});


router.get('/checkpoint', async (req, res) => {
    try {
        console.log(`🧹 Manual Checkpoint triggered for ALL databases...`);

        // 1. Dynamically find all unique databases from your CLIENT_CONFIGS
        const databasesToSync = new Set();
        for (const client of Object.values(CLIENT_CONFIGS)) {
            for (const rule of client.access) {
                databasesToSync.add(rule.database);
            }
        }

        const dbList = Array.from(databasesToSync);
        const results = {};

        // 2. Loop through every database and force the WAL file to merge
        for (const dbName of dbList) {
            console.log(`⏳ Merging WAL file into main DB for: ${dbName}.db...`);

            const db = await dbManager.getDb(dbName);

            // Run the TRUNCATE checkpoint command for this specific database
            await new Promise((resolve, reject) => {
                db.run("PRAGMA wal_checkpoint(TRUNCATE);", function (err) {
                    if (err) {
                        console.error(`❌ Checkpoint failed for ${dbName}:`, err);
                        return reject(err);
                    }
                    resolve();
                });
            });

            results[dbName] = "Merged and Truncated successfully ✅";
            console.log(`✅ ${dbName}.db is now fully merged and safe!`);
        }

        // 3. Send a success response with the status of all databases
        res.status(200).json({
            status: "success",
            message: "All databases successfully merged and truncated.",
            syncedDatabases: results
        });

    } catch (error) {
        console.error('Checkpoint error:', error);
        res.status(500).json({
            error: 'Failed to run database checkpoint',
            details: error.message
        });
    }
});


router.get("/bulkSafeSyncProducts", bulkSafeSyncProducts);
router.get("/bulkProductOutOfStock", BulkProductOutOfStock);



export default router;