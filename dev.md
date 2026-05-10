## Developer & Admin API Reference (`/dev`)

This section documents the internal developer and administrative APIs used to manage the UltimateScrapper backend, synchronize data with WooCommerce, and perform automated database maintenance.

---

### `GET /dev/update-stale-sizes`

#### 📝 About this API
A highly optimized, native SQLite maintenance route designed specifically for the `shoes.db` database. It automatically identifies "stale" inventory (shoes that have not been scraped or updated in the last 72 hours), marks them as "Out of Stock" (`availability = 0`), clears their available sizes array (`sizeName = '[]'`), and updates their timestamp.

**Key Features:**
* Uses native SQLite `CAST` operations for lightning-fast bulk updates, avoiding Node.js memory limits.
* Specifically targets the `shoes` database to prevent accidental modification of watches or other product categories.
* Safeguards against infinite loops by ensuring it only targets currently available products or those that need their sizes cleared.

#### 🚀 How to Trigger It
This route requires no authentication headers or complex payloads. It can be triggered manually via a web browser, Postman, or set up on an automated Cron job.

GET https://your-server.onrender.com/dev/update-stale-sizes

Request Parameters
This endpoint accepts no query parameters.
💡 Examples & Responses
Scenario 1: Stale Products Found & Updated
If the database contains shoes that haven't been updated in 72 hours, the API will instantly update their availability to 0 and clear their sizes.
Request: GET /dev/update-stale-sizes

{
  "message": "Update completed",
  "updatedCount": 14,
  "totalStale": 14,
  "staleIds":[
    50123, 50124, 50125, 50140, 50145, 
    50188, 50190, 50201, 50222, 50223, 
    50224, 50225, 50226, 50227
  ]
}
Scenario 2: Database is Clean (No Stale Products)
If the scraper is running perfectly and all shoes have been updated recently, the API will safely return without executing any updates.
Request: GET /dev/update-stale-sizes
Response (200 OK):

{
  "message": "No outdated products found.",
  "updatedCount": 0
}
Scenario 3: Server or Database Error
If the database file is locked or missing, the API catches the error gracefully.
Response (500 Internal Server Error):
{
  "error": "Failed to update stale sizes",
  "details": "SQLITE_BUSY: database is locked"
}


### `GET /dev/getProductBydetails`

#### 📝 About this API
A powerful diagnostic and batch-deletion tool designed to search for products across all connected WooCommerce websites simultaneously. It allows developers to search by standard fields (like SKU) or custom Meta Fields. If the `delete` parameter is passed, the API initiates a globally synchronized, batch-based permanent deletion sequence to safely wipe products off WooCommerce without overloading the servers.

**Key Features:**
* **Global Search:** Simultaneously queries every site in the `WP_SITES` configuration.
* **Custom Meta Field Support:** Integrates with the custom WordPress `functions.php` snippet to search hidden fields (e.g., `productFetchedFrom`).
* **Safe Batch Deletion:** Instead of sending hundreds of delete requests at once, it chops the deletions into batches of 50 per site, executing them globally, and logging the successes/failures.

#### 🚀 How to Trigger It
Can be triggered manually via a web browser or Postman. 

**Endpoint Base:**
```http
GET https://your-server.onrender.com/dev/getProductBydetails

 Request Parameters
property (Required): The field to search (e.g., sku, status, or a custom meta key like productFetchedFrom).
value (Required): The value to match (e.g., shoezone17).
compare (Optional): Set to contains for partial matching (SQL LIKE). Defaults to exact match (=).
siteName (Optional): Filters the search/deletion to a specific site (e.g., stylenova). If omitted, searches all sites.
delete (Optional): Set to true to activate the permanent deletion mode.
💡 Examples & Responses
Scenario 1: Safe Diagnostic Search (View Only)
Use this to find exactly how many products exist on WooCommerce from a specific scraper site.
Request: GET /dev/getProductBydetails?property=productFetchedFrom&value=shoezone17&compare=contains
Response (200 OK):
code
JSON
{
  "searchQuery": {
    "property": "productFetchedFrom",
    "compareRule": "LIKE",
    "value": "shoezone17"
  },
  "action": "searched",
  "totalSitesProcessed": 2,
  "results":[
    {
      "siteName": "TimesKeepers",
      "matchCount": 2,
      "deletedCount": 0,
      "deletedIds": [],
      "products":[
        {
          "id": 5860,
          "name": "Cartie r Tank",
          "sku": "12345",
          "price": "950",
          "status": "publish",
          "permalink": "https://timekeepers.in/product/cartie-r-tank/"
        },
        // ...
      ]
    },
    {
      "siteName": "StyleNova",
      "matchCount": 0,
      "deletedCount": 0,
      "deletedIds":[],
      "products":[]
    }
  ]
}
Scenario 2: Synchronized Global Deletion (DANGER)
Use this to permanently delete the products found in Scenario 1.
Request: GET /dev/getProductBydetails?property=productFetchedFrom&value=shoezone17&compare=contains&delete=true
Response (200 OK):
code
JSON
{
  "searchQuery": {
    "property": "productFetchedFrom",
    "compareRule": "LIKE",
    "value": "shoezone17"
  },
  "action": "deleted_simultaneously",
  "totalSitesProcessed": 2,
  "results":[
    {
      "siteName": "TimesKeepers",
      "matchCount": 2,
      "deletedCount": 2,
      "deletedIds":[5860, 5861],
      "products": [...]
    }
  ]
}
Scenario 3: Missing Required Parameters
If the property or value is left blank, the API rejects the request to prevent full-database queries.
Response (400 Bad Request):
code
JSON
{
  "error": "Please provide 'property' and 'value'."
}