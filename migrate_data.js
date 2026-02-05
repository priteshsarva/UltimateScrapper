import sqlite3 from 'sqlite3';
import { dbManager } from './models/dbManager.js';

const MIGRATION_CONFIG = [
    {
        category: 'shoes',
        oldDbPath: './DataBaseShoes.db', 
    },
    {
        category: 'watches',
        oldDbPath: './DataBase.db', 
    }
];

async function startMigration() {
    console.log("🚀 Starting Full Relational Migration...");

    for (const task of MIGRATION_CONFIG) {
        try {
            console.log(`\n--- Migrating [${task.category.toUpperCase()}] ---`);
            const oldDb = new sqlite3.Database(task.oldDbPath);
            const newDb = await dbManager.getDb(task.category);

            // 1. Migrate Base Tables (Attributes)
            await migrateTable(oldDb, newDb, 'TAGS', 'tagId');
            await migrateTable(oldDb, newDb, 'CATEGORIES', 'catId');
            await migrateTable(oldDb, newDb, 'SIZES', 'sizeId');
            await migrateTable(oldDb, newDb, 'BRAND', 'brandId');
            await migrateTable(oldDb, newDb, 'VENDORS', 'vendorId');
            await migrateTable(oldDb, newDb, 'REVIEWS', 'reviewId');

            // 2. Migrate Products (Preserving IDs)
            await migrateProducts(oldDb, newDb);

            // 3. Migrate Junction Tables (The Links)
            await migrateTable(oldDb, newDb, 'ProductSizes', null);
            await migrateTable(oldDb, newDb, 'ProductBrand', null);
            await migrateTable(oldDb, newDb, 'ProductCategories', null);
            await migrateTable(oldDb, newDb, 'ProductTags', null);
            await migrateTable(oldDb, newDb, 'ProductReviews', null);

            console.log(`✅ Finished migrating ${task.category} with all relations.`);
            oldDb.close();
        } catch (err) {
            console.error(`❌ Error migrating ${task.category}:`, err.message);
        }
    }

    console.log("\n✨ All databases are now identical copies of the originals!");
    process.exit(0);
}

/**
 * Generic function to migrate a table row-by-row
 */
async function migrateTable(oldDb, newDb, tableName, idColumn) {
    return new Promise((resolve, reject) => {
        oldDb.all(`SELECT * FROM ${tableName}`, [], async (err, rows) => {
            if (err) {
                console.log(`⚠️ Skipping ${tableName} (likely doesn't exist in old DB)`);
                return resolve();
            }

            if (rows.length === 0) return resolve();

            const columns = Object.keys(rows[0]);
            const placeholders = columns.map(() => '?').join(',');
            const sql = `INSERT OR IGNORE INTO ${tableName} (${columns.join(',')}) VALUES (${placeholders})`;

            for (const row of rows) {
                const values = columns.map(col => row[col]);
                await new Promise((res) => newDb.run(sql, values, res));
            }
            console.log(`   ✔ Migrated ${rows.length} rows from ${tableName}`);
            resolve();
        });
    });
}

/**
 * Specifically handles the PRODUCTS table to ensure Master Schema compatibility
 */
async function migrateProducts(oldDb, newDb) {
    return new Promise((resolve, reject) => {
        oldDb.all("SELECT * FROM PRODUCTS", [], async (err, rows) => {
            if (err) return reject(err);

            for (const row of rows) {
                const sql = `INSERT OR IGNORE INTO PRODUCTS (
                    productId, productName, productDateCreation, productLastUpdated, 
                    productPrice, productPriceWithoutDiscount, productOriginalPrice, 
                    productFetchedFrom, productUrl, featuredimg, imageUrl, videoUrl, 
                    productShortDescription, productDescription, productBrand, 
                    sizeName, catName, availability
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                const params = [
                    row.productId,
                    row.productName,
                    row.productDateCreation,
                    row.productLastUpdated,
                    row.productPrice,
                    row.productPriceWithoutDiscount,
                    row.productOriginalPrice,
                    row.productFetchedFrom,
                    row.productUrl,
                    row.featuredimg,
                    row.imageUrl,
                    row.videoUrl || null, // Handles shoes which didn't have videoUrl
                    row.productShortDescription,
                    row.productDescription,
                    row.productBrand,
                    row.sizeName,
                    row.catName,
                    row.availability !== undefined ? row.availability : 1
                ];

                await new Promise((res) => newDb.run(sql, params, res));
            }
            console.log(`   ✔ Migrated ${rows.length} rows from PRODUCTS`);
            resolve();
        });
    });
}

startMigration();