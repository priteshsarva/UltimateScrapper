import { DB } from "./models/connect.js";
import { exec } from 'child_process';

import express, { json } from "express";
import bodyParser from "body-parser";
import router from "./routes/routes.js";
import categories from "./routes/categories.js";
import product from "./routes/product.js";
import sizes from "./routes/sizes.js";
import tags from "./routes/tags.js";
import vendor from "./routes/vendor.js";
import productSizes from "./routes/productSizes.js";
import productCategories from "./routes/productCategories.js";
import { fetchDataa } from "./core/newtemp.js";
import brand from "./routes/brand.js";
import productBrand from "./routes/productBrand.js";
import { baseUrls } from "./config/baseUrls.js";
import fs from 'fs';
import cors from 'cors';
import { fixBrandsFromMap } from "./services/wpBulkSafeSync.js";
import productRoutes from './routes/productRoutes.js'
import { tenantIdentify } from './middleware/tenantIdentify.js';
import { SITES_REGISTRY } from './config/sites.js';


import { executeScraper } from './core/scraperManager.js'
// const PORT = process.env.PORT || 5000;
const PORT = 80; // Force port 80 for production behind Cloudflare



const app = express()
app.use(express.json());// for parsing application/json
// Enable CORS for all routes
app.use(cors({
    // origin: 'http://localhost:5173', // Allow requests from this origin
    // origin: ['http://localhost:5173', 'https://your-frontend-domain.com'], // Allow specific origins
    // credentials: true, // Allow credentials (cookies, authorization headers)

    origin: '*', // Allow requests from all origin
    credentials: false,// Allow credentials (cookies, authorization headers)

    methods: 'GET,POST,PUT,DELETE', // Allow specific HTTP methods
}));
app.options('*', cors()); // Handle preflight requests for all routes

app.get('/', async (req, res) => {
    console.log("working");

    res.set('content-type', 'application/json');
    res.status(200).json({ status: 200, server: "Runnnig" });

});

// app.use(router)
// app.use('/category', categories)
// app.use('/size', sizes)
// app.use('/tag', tags)
// app.use('/vendor', vendor)
// app.use('/productsize', productSizes)
// app.use('/productcategories', productCategories)
// app.use('/brand', brand)
// app.use('/productbrand', productBrand)


// app.use('/product', product)
app.use('/product', tenantIdentify, productRoutes);

app.get('/updateserver', async (req, res) => {
    console.log("working");

    const now = new Date();
    const dateTimeString = now.toISOString().replace('T', ' ').split('.')[0]; // Format: YYYY-MM-DD HH:mm:ss
    const commitMessage = `DB updated on ${dateTimeString}`;

    // Step 1: Add all changes
    exec('git add .', (err) => {
        if (err) {
            console.error('❌ Error adding files:', err);
            return;
        }
        console.log('✅ Changes staged.');

        // Step 2: Commit with message
        exec(`git commit -m "${commitMessage}"`, (err) => {
            if (err) {
                if (err.message.includes('nothing to commit')) {
                    console.log('ℹ️ No changes to commit.');
                    return;
                }
                console.error('❌ Error committing:', err);
                return;
            }
            console.log('✅ Changes committed.');

            // Step 4: Push to remote
            exec('git push', (err) => {
                if (err) {
                    console.error('❌ Error pushing to remote:', err);
                    return;
                }
                console.log('✅ Changes pushed to remote repository.');
            });
        });
    });

    res.status(200).json({ status: 200, message: `Server updated` });
})

app.get('/devproductupdates',async (req, res) => {
    res.set('content-type', 'application/json');
    // Get the current timestamp
    const timestamp = Date.now();

    // Convert the timestamp to a Date object
    const date = new Date(timestamp);

    // Format the date and time with time zone
    const options = {
        weekday: 'short', // "Fri"
        year: 'numeric', // "2017"
        month: 'short', // "Nov"
        day: 'numeric', // "17"
        hour: '2-digit', // "19"
        minute: '2-digit', // "15"
        second: '2-digit', // "15"
        timeZone: 'Asia/Kolkata', // Time zone for Kolkata
        timeZoneName: 'longOffset', // "GMT+05:30"
    };

    // Format the date and time
    const formattedDate = date.toLocaleString('en-IN', options);
    try {
        // fetchDataa(baseUrls);

        for (const site of SITES_REGISTRY) {
            console.log(site.searchKey);
            await executeScraper(site.searchKey); // ✅ correct
        }

        res.status(200).json({ status: 200, message: `Scrapping started at: ${formattedDate}` });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ status: 500, message: 'Internal Server Error' });
    }

})

// app.get('/updatebrand', (req, res) => {
//     fixBrandsFromMap();
//     res.status(200).json({ status: 200, message: `working` });
// })

app.listen(PORT, (err) => {
    if (err) {
        return console.log(err);
    }
    console.log(`Server is running on port ${PORT}`);

})

// executeScraper('metrokicks');
