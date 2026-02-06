import { SITES_REGISTRY } from '../config/sitesConfig.js';
import { dbManager } from '../../models/dbManager.js';
import { runMethodA } from './strategies/methodA.js';
import { runMethodB } from './strategies/methodB.js';

export async function executeScraping(siteId) {
    // 1. Find site config
    const config = SITES_REGISTRY.find(s => s.id === siteId);
    if (!config) throw new Error("Site ID not found in registry");

    console.log(`📡 Starting Scraper for: ${config.name} | Method: ${config.method}`);

    // 2. Route to the correct Strategy
    let products = [];
    if (config.method === "METHOD_A") {
        products = await runMethodA(config.base_url, config.selectors);
    } else if (config.method === "METHOD_B") {
        products = await runMethodB(config.base_url, config.selectors);
    }
    // ... add Method C, D, E later

    if (products.length === 0) {
        console.log(`⚠️ No products found for ${config.name}`);
        return;
    }

    // 3. Connect to the correct Database (Dynamic!)
    const db = await dbManager.getDb(config.category);

    // 4. Save Products with the site URL (for your API filter)
    for (const item of products) {
        await saveToDatabase(db, {
            ...item,
            productFetchedFrom: config.base_url // This matches your LIKE query
        });
    }

    console.log(`✅ Success! ${products.length} products saved to ${config.category}.db`);
}

async function saveToDatabase(db, p) {
    const sql = `INSERT OR REPLACE INTO PRODUCTS (
        productName, productOriginalPrice, productFetchedFrom, productUrl, 
        featuredimg, imageUrl, productBrand, sizeName, catName, availability
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    return new Promise(res => db.run(sql, [
        p.productName, p.productPrice, p.productFetchedFrom, p.productUrl,
        p.featuredimg, p.imageUrl, p.productBrand, p.sizeName, p.catName, 1
    ], res));
}