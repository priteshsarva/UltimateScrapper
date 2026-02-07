import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { dbManager } from '../models/dbManager.js';
import { SITES_REGISTRY } from '../config/sites.js';
import { fetchDataa } from "./strategies/methodA.js";
import { promisify } from 'util';


puppeteer.use(StealthPlugin());

export async function executeScraper(siteId) {
    const config = SITES_REGISTRY.find(s => s.id === siteId);
    if (!config) throw new Error("Site ID not found");

    // 1. Get the correct Database (Shoes vs Watches)
    const DB = await dbManager.getDb(config.category);
    // Promisify DB methods for easier async/await usage
    DB.run = promisify(DB.run);
    DB.get = promisify(DB.get);

    // 2. Launch Browser
    // const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    // const page = await browser.newPage();

    try {
        // 3. Select Strategy
        if (config.method === "METHOD_A") {
            // This is your Cartpe logic
            console.log("METHOD_A");
            console.log(config.base_url);

            await fetchDataa(config.base_url,DB);
        }
        else if (config.method === "METHOD_B") {
            console.log(siteId);

            console.log("METHOD_B");

        }

    } catch (err) {
        console.error(`Scraper failed for ${siteId}:`, err.message);
    } finally {
        console.log(`🏁 Finished process for ${config.name}`);
    }
}