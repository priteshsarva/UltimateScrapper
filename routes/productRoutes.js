import express from 'express';
import { CLIENT_CONFIGS } from '../config/clients.js';
import { getClientData } from '../utils/multiDbHandler.js';
import { dbManager } from '../models/dbManager.js';

const router = express.Router();

/**
 * Endpoint: /product/search
 */
router.get('/search', async (req, res) => {
    console.log("search");

    const { q, brand, size, category } = req.query;
    const limit = parseInt(req.query.result) || 2;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    let sql = `SELECT * FROM products WHERE 1=1 AND availability IN (1, TRUE, 'true') `;
    let params = [];

    if (q) { sql += ` AND LOWER(productName) LIKE ?`; params.push(`%${q.toLowerCase()}%`); }
    if (brand) { sql += ` AND LOWER(productBrand) = ?`; params.push(brand.toLowerCase()); }

    // Combined query across allowed DBs
    const allMatching = await getClientData(req.clientConfig, 'search', { sql, params });
    // console.log(allMatching);

    const totalCount = allMatching.length;
    const paginated = allMatching.slice(offset, offset + limit);

    res.json({
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        results: paginated
    });
});


router.get('/allresults', async (req, res) => {
    // REMOVE the ORDER BY from here. 
    // getClientData handles sorting automatically for you.
    const sql = `SELECT * FROM PRODUCTS ORDER BY productDateCreation DESC`; 
    
    try {
        const results = await getClientData(req.clientConfig, 'allresults', { sql, params: [] });
        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});




/**
 * Endpoint: /product/firstdata
 */
router.get('/firstdata', async (req, res) => {
    // Logic: Get top 30 products from allowed scope
    const sql = `SELECT * FROM products WHERE availability IN (1, TRUE, 'true') `;
    const results = await getClientData(req.clientConfig, 'firstdata', { sql, params: [] });

    const limited = results.slice(0, 30);
    res.json({ totalCount: limited.length, results: limited });
});


/**
 * Endpoint: /product/:id
 * Note: Since IDs might conflict between Shoes and Watches, 
 * we check all allowed DBs until we find it.
 */
router.get('/:id', async (req, res, next) => {
    const productId = req.params.id;
    // if (productId === 'firstdata') return next(); // Skip to firstdata route

    let foundProduct = null;
    for (const rule of req.clientConfig.access) {
        const db = await dbManager.getDb(rule.database);
        const row = await new Promise(res => db.get("SELECT * FROM products WHERE productId = ?", [productId], (err, row) => res(row)));
        if (row) { foundProduct = row; break; }
    }

    res.json({ results: foundProduct ? [foundProduct] : [] });
});


export default router;