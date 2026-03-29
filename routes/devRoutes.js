import express from 'express';
import { dbManager } from '../models/dbManager.js';
import { bulkSafeSyncProducts, BulkProductOutOfStock } from "../core/wpBulkSafeSync.js";
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
                resolve(rows ||[]);
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
            db.run(updateSQL,[now, cutoff], function(err) {
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