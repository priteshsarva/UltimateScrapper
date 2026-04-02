import express from 'express';
import { dbManager } from '../models/dbManager.js';
import { bulkSafeSyncProducts, BulkProductOutOfStock, getProductBydetails, WP_SITES, deleteProduct } from "../core/wpBulkSafeSync.js";
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
        // Grab property, value, compare, siteName, and delete from the URL
        const { property, value, siteName } = req.query;
        let compare = req.query.compare || '='; // Default to Exact Match

        // Check if user requested deletion (e.g., ?delete=true)
        const shouldDelete = req.query.delete === 'true';

        // Make it user-friendly: if they type 'contains', change it to SQL 'LIKE'
        if (compare.toLowerCase() === 'contains') {
            compare = 'LIKE';
        }

        if (!property || !value) {
            return res.status(400).json({
                error: "Please provide 'property' and 'value'."
            });
        }

        // =====================================
        // FILTER SITES BY 'siteName' PARAMETER
        // =====================================
        let targetSites = WP_SITES;

        if (siteName) {
            // Find the specific site ignoring case (e.g., 'stylenova' or 'StyleNova')
            targetSites = WP_SITES.filter(s => s.name.toLowerCase() === siteName.toLowerCase());

            if (targetSites.length === 0) {
                return res.status(404).json({
                    error: `Site '${siteName}' not found. Available sites: ${WP_SITES.map(s => s.name).join(', ')}`
                });
            }
        }

        console.log(`🔍 Searching across ${targetSites.length} site(s): [${property}] ${compare} [${value}]`);
        if (shouldDelete) console.log(`⚠️ WARNING: Deletion mode is ENABLED!`);

        // =====================================
        // FETCH (AND OPTIONALLY DELETE) PRODUCTS
        // =====================================
        const fetchPromises = targetSites.map(async (site) => {
            const products = await getProductBydetails(property, value, compare, site);

            let deletedCount = 0;
            let deletedIds = [];

            // If deletion mode is ON, delete products one by one safely
            if (shouldDelete && products.length > 0) {
                for (const p of products) {
                    const success = await deleteProduct(p.id, site);
                    if (success) {
                        deletedCount++;
                        deletedIds.push(p.id);
                    }
                    // Pause for 250ms between deletes to prevent crashing WooCommerce
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
            }

            // Map the results to keep the JSON clean and easy to read
            return {
                siteName: site.name,
                matchCount: products.length,
                deletedCount: deletedCount,
                deletedIds: deletedIds,
                products: products.map(p => ({
                    id: p.id,
                    name: p.name,
                    sku: p.sku,
                    price: p.price,
                    status: p.status,
                    permalink: p.permalink
                }))
            };
        });

        // Wait for all sites to finish searching (and deleting)
        const allResults = await Promise.all(fetchPromises);

        // 3. Return the grouped results
        res.status(200).json({
            searchQuery: { property, compareRule: compare, value },
            action: shouldDelete ? "deleted" : "searched",
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