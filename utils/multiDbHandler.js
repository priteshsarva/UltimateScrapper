import { dbManager } from '../models/dbManager.js';
import { SITES_REGISTRY } from '../config/sites.js';

export async function getClientData(clientConfig, queryType, queryParams) {
    let allResults = [];

    for (const rule of clientConfig.access) {
        const db = await dbManager.getDb(rule.database);
        let sql = queryParams.sql;
        let params = [...queryParams.params];

        // Apply Manufacturer Filter
        if (rule.manufacturers !== "all") {
            const searchKeys = SITES_REGISTRY
                .filter(s => rule.manufacturers.includes(s.id))
                .map(s => `%${s.searchKey}%`);

            if (searchKeys.length > 0) {
                const whereClause = searchKeys.map(() => "productFetchedFrom LIKE ?").join(" OR ");
                sql += ` AND (${whereClause})`;
                params.push(...searchKeys);
            }
        }
// console.log(sql, params);

        const rows = await new Promise((res) => db.all(sql, params, (err, rows) => res(rows || [])));
        // Tag result so we know which DB it came from
        allResults.push(...rows.map(r => ({ ...r, originDb: rule.database })));
    }

    // Sort combined results by date (Newest first)
    return allResults.sort((a, b) => b.productDateCreation - a.productDateCreation);
}