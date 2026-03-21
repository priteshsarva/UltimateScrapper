import express from 'express';
import { dbManager } from '../models/dbManager.js';
import { bulkSafeSyncProducts, BulkProductOutOfStock } from "../core/wpBulkSafeSync.js";

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
        const selectSQL = `SELECT productId FROM PRODUCTS WHERE CAST(productLastUpdated AS INTEGER) < ?`;
        
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

router.get("/bulkSafeSyncProducts", bulkSafeSyncProducts);
router.get("/bulkProductOutOfStock", BulkProductOutOfStock);

export default router;