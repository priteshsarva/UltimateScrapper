// src/middleware/tenantIdentify.js
import { CLIENT_CONFIGS } from '../config/clients.js';

export const tenantIdentify = (req, res, next) => {
    // 1. Check for Host header (Production) or x-client-id (Testing)
    const host = req.headers['x-client-id'] || req.headers.host || "";

    // 2. Logic to match the host to our config keys
    let selectedConfig = null;

    if (host.includes("kicksmania")) {
        selectedConfig = CLIENT_CONFIGS["kicksmania.co.in"];
    } else if (host.includes("timekeepers")) {
        selectedConfig = CLIENT_CONFIGS["timekeepers.in"];
    } else if (host.includes("theaquawatch")) {
        selectedConfig = CLIENT_CONFIGS["theaquawatch.com"];
    } else {
        // DEFAULT: Fallback if no match is found (useful for local development)
        selectedConfig = CLIENT_CONFIGS["kicksmania.co.in"];
    }

    // 3. Attach the config to the request object so routes can use it
    req.clientConfig = selectedConfig;

    console.log(`[Tenant] Identified: ${selectedConfig.name} from Host: ${host}`);
    
    next();
};