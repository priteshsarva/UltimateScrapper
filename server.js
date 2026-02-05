// server.js
import express from 'express';
import { dbManager } from './models/dbManager.js';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = 3000;

// Helper to promisify db.all
const getAll = (db, sql) => new Promise((res, rej) => {
    db.all(sql, [], (err, rows) => err ? rej(err) : res(rows));
});

// ROUTE 1: Get all products from a SPECIFIC database
// Example: http://localhost:3000/api/shoes/products
app.get('/api/:category/products', async (req, res) => {
    try {
        const { category } = req.params;
        const db = await dbManager.getDb(category);
        const products = await getAll(db, "SELECT * FROM PRODUCTS");
        res.json({ category, count: products.length, products });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ROUTE 2: Get all products from ALL databases
// Example: http://localhost:3000/api/all-products
app.get('/api/all-products', async (req, res) => {
    try {
        const dbFiles = fs.readdirSync('./databases').filter(file => file.endsWith('.db'));
        let allResults = [];

        for (const file of dbFiles) {
            const category = file.replace('.db', '');
            const db = await dbManager.getDb(category);
            const products = await getAll(db, "SELECT * FROM PRODUCTS");
            
            // Tag each product with its source DB for clarity
            const taggedProducts = products.map(p => ({ ...p, database: category }));
            allResults = allResults.concat(taggedProducts);
        }

        res.json({ totalCount: allResults.length, allResults });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Test API running at http://localhost:${PORT}`);
    console.log(`Try: http://localhost:3000/api/shoes/products`);
    console.log(`Try: http://localhost:3000/api/all-products`);
});