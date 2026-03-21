import express from 'express';
import { CLIENT_CONFIGS } from '../config/clients.js';
import { getClientData } from '../utils/multiDbHandler.js';
import { dbManager } from '../models/dbManager.js';

const router = express.Router();

/**
 * Endpoint: /product/search
 */
// router.get('/search', async (req, res) => {
//     // console.log("search");

//     const { q, brand, size, category } = req.query;
//     const limit = parseInt(req.query.result) || 2;
//     const page = parseInt(req.query.page) || 1;
//     const offset = (page - 1) * limit;

//     let sql = `SELECT * FROM products WHERE 1=1 AND availability IN (1, TRUE, 'true') `;
//     let params = [];

//     if (q) { sql += ` AND LOWER(productName) LIKE ?`; params.push(`%${q.toLowerCase()}%`); }
//     if (brand) { sql += ` AND LOWER(productBrand) = ?`; params.push(brand.toLowerCase()); }

//     // Combined query across allowed DBs
//     const allMatching = await getClientData(req.clientConfig, 'search', { sql, params });
//     // console.log(allMatching);

//     const totalCount = allMatching.length;
//     const paginated = allMatching.slice(offset, offset + limit);

//     res.json({
//         currentPage: page,
//         totalPages: Math.ceil(totalCount / limit),
//         totalCount,
//         results: paginated
//     });
// });

router.get('/search', async (req, res) => {
    try {
        const { q, brand, size, category } = req.query;
        const limit = parseInt(req.query.result) || 12; // Adjusted default for better grid view (you can change back to 2)
        const page = parseInt(req.query.page) || 1;
        const offset = (page - 1) * limit;

        // 1. Handle dbName (Support both ?dbName=watches and ?cat=watches)
        let targetDb = req.query.dbName || req.query.cat;

        // Clean up weird frontend edge cases ('undefined' as string)
        if (targetDb === 'undefined' || targetDb === 'null' || targetDb === '') {
            targetDb = null;
        }

        // 2. Build the SQL Query dynamically
        let sql = `SELECT * FROM PRODUCTS WHERE availability IN (1, '1', TRUE, 'true') `;
        let params = [];

        if (q) {
            sql += ` AND LOWER(productName) LIKE ?`;
            params.push(`%${q.toLowerCase()}%`);
        }
        if (brand) {
            sql += ` AND LOWER(productBrand) = ?`;
            params.push(`%${brand.toLowerCase()}%`);
        }
        if (category) {
            sql += ` AND LOWER(catName) LIKE ?`;
            params.push(`%${category.toLowerCase()}%`);
        }
        if (size) {
            sql += ` AND sizeName LIKE ?`;
            params.push(`%${size}%`);
        }

        // 3. Filter which databases we are allowed to search
        // If targetDb is provided, strictly search ONLY that DB. 
        // Otherwise, search all DBs this client has access to.
        const filteredAccess = targetDb
            ? req.clientConfig.access.filter(rule => rule.database === targetDb)
            : req.clientConfig.access;

        // If the requested DB is invalid or client doesn't have access, return empty
        if (filteredAccess.length === 0) {
            return res.json({
                currentPage: page,
                totalPages: 0,
                totalCount: 0,
                results: []
            });
        }

        // 4. Create a temporary config object with ONLY the allowed databases
        const searchConfig = {
            ...req.clientConfig,
            access: filteredAccess
        };
        

        // 5. Run the combined query across the filtered DBs
        const allMatching = await getClientData(searchConfig, 'search', { sql, params });

        // 6. Handle Pagination
        const totalCount = allMatching.length;
        const paginated = allMatching.slice(offset, offset + limit);

        // 7. Return the final results
        res.json({
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit),
            totalCount,
            results: paginated
        });

    } catch (error) {
        console.error("Search Route Error:", error);
        res.status(500).json({ error: 'Failed to perform search' });
    }
});

router.get('/allresults', async (req, res) => {
    // REMOVE the ORDER BY from here. 
    // getClientData handles sorting automatically for you.
    const sql = `SELECT * FROM PRODUCTS ORDER BY productDateCreation DESC`;

    try {
        const results = await getClientData(req.clientConfig, 'allresults', { sql, params: [] });
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});




/**
 * Endpoint: /product/firstdata
 */
router.get('/firstdata', async (req, res) => {
    try {
        // Fetch top 30 from EACH database in their normal order (e.g., newest first)
        // You can change 'productId DESC' to 'productDateCreation DESC' if you prefer
        const sql = `SELECT * FROM PRODUCTS WHERE availability IN (1, '1', TRUE, 'true') ORDER BY productId DESC LIMIT 30`;

        const results = await getClientData(req.clientConfig, 'firstdata', { sql, params: [] });

        // Take exactly 30 items from the newly blended array
        const limited = results.slice(0, 60);
        res.json({ totalCount: limited.length, results: limited });
    } catch (error) {
        console.error("Route Error:", error);
        res.status(500).json({ error: 'Failed to fetch first data' });
    }
});
 

router.get('/:id', async (req, res, next) => {
    try {
        const productId = req.params.id;

        // Grab dbName from query
        let targetDb = req.query.cat;

        // Clean up weird frontend edge cases
        if (targetDb === 'undefined' || targetDb === 'null' || targetDb === '') {
            targetDb = null;
        }

        let foundProduct = null;

        for (const rule of req.clientConfig.access) {

            // 1. If dbName provided, only search that DB
            if (targetDb && rule.database !== targetDb) {
                continue;
            }

            const db = await dbManager.getDb(rule.database);

            let sql = "SELECT * FROM products WHERE productId = ?";
            let params = [productId];

            // 2. SECURITY CHECK: Manufacturer filter
            if (rule.manufacturers !== "all") {
                const searchKeys = SITES_REGISTRY
                    .filter(s => rule.manufacturers.includes(s.id))
                    .map(s => `%${s.searchKey}%`);

                if (searchKeys.length > 0) {
                    const whereClause = searchKeys
                        .map(() => "productFetchedFrom LIKE ?")
                        .join(" OR ");

                    sql += ` AND (${whereClause})`;
                    params.push(...searchKeys);
                } else {
                    // No allowed manufacturers → skip this DB
                    continue;
                }
            }

            // Fetch single product
            const row = await new Promise((resolve, reject) => {
                db.get(sql, params, (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });

            if (row) {
                // 3. Attach dbName
                foundProduct = { ...row, dbName: rule.database };
                break;
            }
        }

        // 4. Return result properly (FIXED)
        res.json({
            results: foundProduct ? [foundProduct] : []
        });

    } catch (error) {
        next(error);
    }
});



export default router;