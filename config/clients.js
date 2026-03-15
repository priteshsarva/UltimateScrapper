export const CLIENT_CONFIGS = {
    "timekeepers.in": {
        name: "TimeKeepers",
        access: [
            { database: "watches", manufacturers: "all" },
            { database: "shoes", manufacturers: "all" } // Example few manufacturers
        ]
    },
    "kicksmania.co.in": {
        name: "Kicksmania",
        access: [
            { database: "shoes", manufacturers: "all" }
        ]
    },
    "theaquawatch.com": {
        name: "TheAquaWatch",
        access: [
            { database: "watches", manufacturers: "all" }
        ]
    }
};