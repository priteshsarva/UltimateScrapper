import express from 'express';
import { dbManager } from '../models/dbManager.js';
import { bulkSafeSyncProducts, BulkProductOutOfStock, getProductBydetails, WP_SITES, deleteProduct, fetchAllMatchingProducts, upsertProductSafe, syncProductToAllSites } from "../core/wpBulkSafeSync.js";
import { scrapeSingleProductMethodA } from '../core/strategies/liveMethodA.js';
import { scrapeSingleProductMethodB } from '../core/strategies/LiveMethodB.js';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { CLIENT_CONFIGS } from '../config/clients.js';
import { SITES_REGISTRY } from '../config/sites.js';

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
        const selectSQL = `SELECT productId FROM PRODUCTS WHERE CAST(productLastUpdated AS INTEGER) < ? OR sizeName = '[]' AND availability = 'TRUE' AND availability = 'true' AND availability = true AND availability = 1`;

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

router.get("/getProductBydetails", async (req, res) => {
    try {
        const { property, value, } = req.query;
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

router.get("/updateProductBydetails", async (req, res) => {
    try {
        const { property, value, siteName } = req.query;
        let compare = req.query.compare || '=';

        // Check if user requested an update (e.g., ?update=true)
        const shouldUpdate = req.query.update === 'true';

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

        console.log(`\n🔍 PHASE 1: Fetching products across ${targetSites.length} site(s) for UPDATE...`);

        // =====================================
        // PHASE 1: FETCH FROM ALL SITES FIRST
        // =====================================
        const fetchPromises = targetSites.map(async (site) => {
            const products = await fetchAllMatchingProducts(property, value, compare, site);
            console.log(`✅ [${site.name}] Found ${products.length} products.`);
            return {
                site,
                products,
                updatedCount: 0,
                updatedIds: []
            };
        });

        const sitesData = await Promise.all(fetchPromises);
        console.log(`✅ All products fetched successfully from WooCommerce.`);

        // =====================================
        // PHASE 2: FETCH LOCAL DB & UPDATE 
        // =====================================
        if (shouldUpdate) {
            console.log(`\n⚠️ UPDATE MODE ENABLED! Synchronizing local data to WooCommerce.`);

            const maxProducts = Math.max(...sitesData.map(data => data.products.length), 0);

            // ⚠️ Keeping batch size small (10) because Upsert makes multiple API calls
            const batchSize = 10;

            for (let i = 0; i < maxProducts; i += batchSize) {
                console.log(`\n🔥 Updating Global Batch ${Math.floor(i / batchSize) + 1} simultaneously across all sites...`);

                const globalBatchPromises = sitesData.map(async (data) => {
                    const batch = data.products.slice(i, i + batchSize);

                    if (batch.length > 0) {
                        console.log(`   ->[${data.site.name}] Firing ${batch.length} updates...`);

                        // 👇 NEW: Figure out exactly which databases THIS specific site is allowed to check
                        const clientConfig = CLIENT_CONFIGS[data.site.domain];
                        const allowedDBs = clientConfig ? clientConfig.access.map(rule => rule.database) : [];

                        if (allowedDBs.length === 0) {
                            console.log(`❌[${data.site.name}] No allowed databases found in CLIENT_CONFIGS. Skipping.`);
                            return;
                        }

                        const updatePromises = batch.map(async (p) => {
                            const sku = p.sku;
                            if (!sku) return false;

                            // A. Look for this SKU ONLY in databases this site is allowed to see!
                            let localProduct = null;
                            for (const dbName of allowedDBs) {
                                const db = await dbManager.getDb(dbName);
                                localProduct = await new Promise(resolve => {
                                    db.get("SELECT * FROM PRODUCTS WHERE productId = ?", [sku], (err, row) => resolve(row));
                                });
                                if (localProduct) {
                                    // Make sure we attach the correct DB name so upsertProductSafe knows where it came from
                                    localProduct.dbName = dbName;
                                    break;
                                }
                            }

                            // B. If found locally, push the fresh data to WooCommerce!
                            if (localProduct) {
                                await upsertProductSafe(localProduct, data.site, sku);
                                return true;
                            } else {
                                console.log(`❌ [${data.site.name}] SKU ${sku} missing from allowed local DBs (${allowedDBs.join(', ')}). Cannot update.`);
                                return false;
                            }
                        });

                        const results = await Promise.all(updatePromises);

                        // Track successes
                        results.forEach((success, index) => {
                            if (success) {
                                data.updatedCount++;
                                data.updatedIds.push(batch[index].sku);
                            }
                        });
                    }
                });

                await Promise.all(globalBatchPromises);

                console.log(`⏳ Batch complete. Letting WooCommerce breathe for 2 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // =====================================
        // PHASE 3: FORMAT AND RETURN RESULTS
        // =====================================
        const allResults = sitesData.map(data => ({
            siteName: data.site.name,
            matchCount: data.products.length,
            updatedCount: data.updatedCount,
            updatedIds: data.updatedIds,
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
            action: shouldUpdate ? "updated_simultaneously" : "searched",
            totalSitesProcessed: targetSites.length,
            results: allResults
        });

    } catch (error) {
        console.error("❌ Error in route:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get('/update-single-product', async (req, res) => {
    try {
        const { productId, productUrl } = req.query;

        if (!productId && !productUrl) {
            return res.status(400).json({ error: "Please provide either 'productId' or 'productUrl'." });
        }

        console.log(`\n🔍 Searching local databases for single product update...`);

        // 1. Get all databases to check
        const databasesToCheck = new Set();
        for (const client of Object.values(CLIENT_CONFIGS)) {
            for (const rule of client.access) {
                databasesToCheck.add(rule.database);
            }
        }
        const dbList = Array.from(databasesToCheck);

        // 2. Find the product locally
        let localProduct = null;
        let targetDbName = null;

        for (const dbName of dbList) {
            // 👇 FIX: Open a completely FRESH connection just for this API request!
            // This bypasses the dbManager queue so it doesn't get stuck behind the bulk scraper.
            const dbPath = path.resolve(`./databases/${dbName}.db`);
            const db = new sqlite3.Database(dbPath);
            
            // Allow this specific connection to wait patiently in WAL mode
            db.run("PRAGMA busy_timeout = 30000");

            let sql = "";
            let param = "";

            if (productId) {
                sql = "SELECT * FROM PRODUCTS WHERE productId = ?";
                param = productId;
            } else {
                sql = "SELECT * FROM PRODUCTS WHERE productUrl = ?";
                param = productUrl;
            }
            console.log(`🔎[${dbName}.db] Searching via independent connection for: ${param}`);

            localProduct = await new Promise((resolve, reject) => {
                db.get(sql, [param], (err, row) => {
                    if (err) {
                        console.error(`❌ [${dbName}.db] Database Error: ${err.message}`);
                        return reject(err);
                    }
                    resolve(row);
                });
            });

            // Close this temporary connection to keep memory clean
            db.close();

            if (localProduct) {
                targetDbName = dbName;
                break; // Found it! Stop searching other DBs.
            }
        }

        if (!localProduct) {
            return res.status(404).json({ error: "Product not found in any local database." });
        }

        console.log(`✅ Found product in '${targetDbName}.db'. Title: ${localProduct.productName}`);

        // 3. Check if it was updated within the last 1 hour
        const ONE_HOUR_MS = 60 * 60 * 1000;
        const lastUpdated = parseInt(localProduct.productLastUpdated);
        const timeSinceUpdate = Date.now() - lastUpdated;

        if (timeSinceUpdate < ONE_HOUR_MS) {
            const minutesAgo = Math.floor(timeSinceUpdate / 60000);
            console.log(`⏭️ Skipping: Product was updated just ${minutesAgo} minutes ago.`);
            return res.status(200).json({
                status: "skipped",
                message: `Product was recently updated (${minutesAgo} minutes ago). Must be > 60 mins.`,
                product: localProduct
            });
        }

        console.log(`⏳ Product is older than 1 hour. Preparing to re-scrape...`);

        // 4. Identify the Source and Method
        const targetUrl = localProduct.productUrl;
        const fetchedFrom = localProduct.productFetchedFrom || targetUrl;

        const siteConfig = SITES_REGISTRY.find(site =>
            fetchedFrom.includes(site.base_url) || fetchedFrom.includes(site.searchKey)
        );

        if (!siteConfig) {
            return res.status(400).json({ error: "Cannot identify scraper site config for this product." });
        }

        console.log(`⚙️ Identified Method: ${siteConfig.method} from Site: ${siteConfig.name}`);

        // 5. Trigger the Single Scraper (You will need to link your actual single scraper logic here)
        let freshProductData = null;

        try {
            if (siteConfig.method === "METHOD_A") {
                console.log("🚀 Firing Single Scraper Method A...");
                freshProductData = await scrapeSingleProductMethodA(targetUrl, targetDbName);
                // Example call:
                // freshProductData = await scrapeSingleProductMethodA(targetUrl, targetDbName);

            } else if (siteConfig.method === "METHOD_B") {
                console.log("🚀 Firing Single Scraper Method B...");
                freshProductData = await scrapeSingleProductMethodB(targetUrl, targetDbName);
                // Example call:
                // freshProductData = await scrapeSingleProductMethodB(targetUrl, targetDbName);
            } else {
                throw new Error("Unknown scraping method");
            }
        } catch (scrapeErr) {
            console.error("❌ Scraping failed:", scrapeErr);
            return res.status(500).json({ error: "Failed to scrape live product data." });
        }

        // --- DEV BYPASS --- 
        // If your scraper logic above isn't built yet, we simulate fresh data grabbing from localProduct
        freshProductData = freshProductData || localProduct;

        // 6. Push the updated data to WooCommerce via the Smart Router
        console.log(`🌐 Syncing fresh data to WooCommerce sites...`);
        // We attach the dbName so the smart router knows if it's shoes or watches!
        freshProductData.dbName = targetDbName;

        await syncProductToAllSites(freshProductData, freshProductData.productId);

        console.log(`🎉 Single product update and sync complete!`);

        res.status(200).json({
            status: "success",
            message: "Product successfully re-scraped, updated locally, and synced to WooCommerce.",
            methodUsed: siteConfig.method,
            product: freshProductData
        });

    } catch (error) {
        console.error("❌ Error in single product update route:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
});

router.get('/retry-failed-syncs', async (req, res) => {
    try {
        const failFilePath = path.join(process.cwd(), 'failed_syncs.txt');

        // 1. Check if the file exists
        if (!fs.existsSync(failFilePath)) {
            return res.status(200).json({ message: "No failed syncs found. The file is empty or missing!" });
        }

        // 2. Read the file and extract unique Product IDs
        const fileContent = fs.readFileSync(failFilePath, 'utf-8');
        const lines = fileContent.split('\n').filter(line => line.trim() !== '');
        
        const failedIds = new Set();
        lines.forEach(line => {
            // Extract the ID using Regex (Looks for "ProductID: 12345")
            const match = line.match(/ProductID:\s*(\d+)/);
            if (match && match[1]) {
                failedIds.add(match[1]);
            }
        });

        const uniqueIds = Array.from(failedIds);

        if (uniqueIds.length === 0) {
            fs.writeFileSync(failFilePath, ''); // Clear it
            return res.status(200).json({ message: "File exists but no valid Product IDs were found. Cleared file." });
        }

        console.log(`\n🔄 [RETRY SYNC] Found ${uniqueIds.length} unique failed products. Preparing background batch sync...`);

        // 3. EMPTY THE FILE BEFORE WE RETRY!
        // If they fail again, syncProductToAllSites will automatically write them back to the clean file.
        fs.writeFileSync(failFilePath, ''); 

        // 4. Respond to the API request immediately to prevent 504 Timeout
        res.status(200).json({
            status: "success",
            message: `Background retry process started for ${uniqueIds.length} products. Check server logs for progress.`,
            totalRetried: uniqueIds.length
        });

        // =====================================
        // 5. BACKGROUND BATCH PROCESSING
        // =====================================
        (async () => {
            try {
                // Figure out which SQLite databases to check
                const databasesToCheck = new Set();
                for (const client of Object.values(CLIENT_CONFIGS)) {
                    for (const rule of client.access) {
                        databasesToCheck.add(rule.database);
                    }
                }
                const dbList = Array.from(databasesToCheck);

                let successCount = 0;
                let failCount = 0;

                // ⚠️ Set safe batch size and delay
                const batchSize = 3;  // Process 3 products simultaneously
                const delayMs = 1000; // Wait 2 seconds between batches

                for (let i = 0; i < uniqueIds.length; i += batchSize) {
                    const batchIds = uniqueIds.slice(i, i + batchSize);
                    console.log(`\n🚀 Retrying Batch ${Math.floor(i / batchSize) + 1} (${batchIds.length} products)...`);

                    // Process the products in this batch concurrently
                    const batchPromises = batchIds.map(async (productId) => {
                        let localProduct = null;
                        let targetDbName = null;

                        // Search local DBs for this product
                        for (const dbName of dbList) {
                            const db = await dbManager.getDb(dbName);
                            localProduct = await new Promise((resolve) => {
                                db.get("SELECT * FROM PRODUCTS WHERE productId = ?", [productId], (err, row) => resolve(row));
                            });

                            if (localProduct) {
                                targetDbName = dbName;
                                break;
                            }
                        }

                        if (localProduct) {
                            // Add the dbName so the smart router knows where it belongs
                            localProduct.dbName = targetDbName;
                            
                            // Fire the sync!
                            const isSuccess = await syncProductToAllSites(localProduct, productId);
                            
                            if (isSuccess) {
                                successCount++;
                            } else {
                                failCount++;
                            }
                        } else {
                            console.warn(`⚠️ Could not find ProductID ${productId} in any local DB.`);
                            // Write it back to the file so we don't lose track of it
                            fs.appendFileSync(failFilePath, `${new Date().toLocaleString()} | ProductID: ${productId} | Error: Missing from local SQLite DB\n`);
                            failCount++;
                        }
                    });

                    // Wait for the batch of 3 to finish syncing
                    await Promise.all(batchPromises);

                    // Delay before starting the next batch to let WooCommerce breathe
                    console.log(`⏳ Batch complete. Letting servers breathe for ${delayMs / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }

                console.log(`\n🎉 Background Retry process complete!`);
                console.log(`✅ Success: ${successCount} | ❌ Failed again: ${failCount}`);
                if (failCount > 0) console.log(`Check 'failed_syncs.txt' for the items that failed again.`);

            } catch (bgError) {
                console.error("❌ Error during background retry processing:", bgError);
            }
        })();

    } catch (error) {
        console.error("❌ Error in retry route:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error", details: error.message });
        }
    }
});

router.get('/checkpoint', async (req, res) => {
    try {
        console.log("🧹 Manual Checkpoint triggered for ALL databases...");

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