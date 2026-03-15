// controller/wpBulkSafeSync.js
import fetch from "node-fetch";
import "dotenv/config";
import { DB } from "../models/connect.js";
import { brandMap } from "../services/updateProductCategoryAndBrand.js";

const WP_URL = process.env.WP_URL;
const WP_CONSUMER_KEY = process.env.WP_CONSUMER_KEY;
const WP_CONSUMER_SECRET = process.env.WP_CONSUMER_SECRET;

const WP_SITES =[
  {
    domain: "timekeepers.in", // <-- MUST MATCH THE KEY IN CLIENT_CONFIGS
    name: "TimesKeepers",
    url: process.env.WP_URL,
    user: process.env.WP_USER,
    password: process.env.WP_APP_PASSWORD,
  },
  {
    domain: "kicksmania.co.in", // <-- MUST MATCH THE KEY IN CLIENT_CONFIGS
    name: "Kicksmania",
    url: process.env.WP_URL_1,
    user: process.env.WP_USER_1,
    password: process.env.WP_APP_PASSWORD_1,
  },
  // add as many as you need...
];

// Add this new function to handle syncs from your scraper ------------OLD
// export async function syncProductToAllSites(product, productId = null) {
//   console.log(`🚀 Syncing scraped product across ${WP_SITES.length} sites...`);

//   const syncPromises = WP_SITES.map((site) =>
//     upsertProductSafe(product, site, productId)
//   );

//   await Promise.all(syncPromises);
// }

// Add this new function to handle syncs from your scraper ----------New
export async function syncProductToAllSites(product, productId = null) {
  // 1. Figure out if this product is 'watches' or 'shoes'
  const databaseType = getProductDatabaseType(product);
  
  // 2. Filter WP_SITES based on what CLIENT_CONFIGS allows
  const eligibleSites = WP_SITES.filter(site => {
      const config = CLIENT_CONFIGS[site.domain];
      if (!config) return false; // If site isn't in config, skip it

      // Check if site's access array includes this database type
      return config.access.some(acc => acc.database === databaseType);
  });

  if (eligibleSites.length === 0) {
      console.log(`⚠️ No eligible sites found for product ${product.productName} (Type: ${databaseType})`);
      return;
  }

  console.log(`🚀 Syncing[${databaseType}] product '${product.productName}' to ${eligibleSites.length} site(s): ${eligibleSites.map(s => s.name).join(", ")}`);

  // 3. Only sync to the filtered list of eligible sites!
  const syncPromises = eligibleSites.map((site) =>
    upsertProductSafe(product, site, productId)
  );

  await Promise.all(syncPromises);
}


function getAuthHeader(site) {
  // const auth = Buffer.from(`${WP_CONSUMER_KEY}:${WP_CONSUMER_SECRET}`).toString("base64");
  // return `Basic ${auth}`;

  // const username = process.env.WP_USER; // <-- add this to your .env
  // const appPassword = process.env.WP_APP_PASSWORD; // <-- add this to your .env
  // const token = Buffer.from(`${username}:${appPassword}`).toString("base64");
  const token = Buffer.from(`${site.user}:${site.password}`).toString("base64");
  return `Basic ${token}`;
}

function getAuthHeadertocreactbrand() {
  const username = process.env.WP_USER; // <-- add this to your .env
  const appPassword = process.env.WP_APP_PASSWORD; // <-- add this to your .env
  const token = Buffer.from(`${username}:${appPassword}`).toString("base64");
  return `Basic ${token}`;
}


// ---------------- CATEGORY HELPERS ----------------
async function getCategoryByName(name, site) {
  try {
    const res = await fetch(`${site.url}/wp-json/wc/v3/products/categories?search=${encodeURIComponent(name)}`, {
      headers: { Authorization: getAuthHeader(site) },
    });
    const data = await res.json();
    return data.length > 0 ? data[0] : null;
  } catch (err) {
    console.error("❌ Error fetching category:", err);
    return null;
  }
}

async function createCategory(name, site) {
  try {
    const res = await fetch(`${site.url}/wp-json/wc/v3/products/categories`, {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(site),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`✅ Category created: ${name} (ID: ${data.id})`);
      return data;
    } else {
      console.error("❌ Error creating category:", data);
      return null;
    }
  } catch (err) {
    console.error("❌ Unexpected error creating category:", err);
    return null;
  }
}

async function getOrCreateCategory(name, site) {
  if (!name) return null;
  let category = await getCategoryByName(name, site);
  if (!category) category = await createCategory(name, site);
  return category?.id || null;
}

// ---------------- PRODUCT HELPERS ----------------
async function getProductBySKU(sku, site) {
  try {
    const res = await fetch(`${site.url}/wp-json/wc/v3/products?sku=${sku}`, {
      headers: { Authorization: getAuthHeader(site) },
    });

    // Check if response is JSON
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      console.error(`❌ WooCommerce did not return JSON for SKU ${sku}`);
      const text = await res.text();
      console.error("Response HTML:", text.slice(0, 300)); // log first 300 chars
      return null;
    }

    const data = await res.json();
    return data.length > 0 ? data[0] : null;
  } catch (err) {
    console.error("❌ Error checking product:", err);
    return null;
  }
}



async function getOrCreateBrand(brandName, site) {
  if (!brandName) return null;

  try {
    const searchUrl = `${site.url}/wp-json/wp/v2/product_brand?search=${encodeURIComponent(brandName)}`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: getAuthHeader(site) },
    });
    const existing = await searchRes.json();

    if (existing.length > 0) {
      console.log(`🏷️ Found existing brand: ${existing[0].name} (ID: ${existing[0].id})`);
      return existing[0].id;
    }

    // Create new brand if not found
    const createRes = await fetch(`${site.url}/wp-json/wp/v2/product_brand`, {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(site),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: brandName }),
    });

    const newBrand = await createRes.json();

    if (createRes.ok) {
      console.log(`🆕 Created new brand: ${newBrand.name} (ID: ${newBrand.id})`);
      return newBrand.id;
    } else {
      console.error("❌ Error creating brand:", newBrand);
      return null;
    }
  } catch (err) {
    console.error("❌ Brand lookup/creation failed:", err);
    return null;
  }
}

export async function upsertProductSafe(product, site, productId = null) {


  try {
    const sku = (productId ?? product.productId)?.toString()
    if (!sku) {
      console.warn(`⚠️ Skipping product — missing productId: ${product.productName}`);
    }


    // Use passed productId if available, otherwise look up by SKU
    let existing = null;
    existing = await getProductBySKU(sku, site);

    // if (!productId) {
    //   existing = await getProductBySKU(sku); 
    //   if (existing) productId = existing.id;
    // } else {
    //   existing = { id: productId };
    // }

    let method = "POST";
    let endpoint = `${site.url}/wp-json/wc/v3/products`;

    if (existing) {
      endpoint = `${site.url}/wp-json/wc/v3/products/${existing.id}`;
      method = "PUT";
      console.log(`ℹ️ [${site.name}] Updating product ID ${existing.id}`);
    } else {
      console.log(`🆕 [${site.name}] Creating new product: ${product.productName}`);
    }

    const categoryId = !existing ? await getOrCreateCategory(product.catName, site) : null;
    // const brandId = !existing ? await getOrCreateBrand(product.productBrand) : null;  //use while creating new
    // const brandId = existing ? await getOrCreateBrand(product.productBrand) : null;  //used while i was doing bulk update
    const brandId = !existing ? await getOrCreateBrand(product.productBrand, site) : null;  //used while i was doing bulk update from devupdate

    let images = [];
    try {
      const imgs = JSON.parse(product.imageUrl);
      images = imgs.map((src) => ({ src }));
    } catch {
      if (product.featuredimg) images.push({ src: product.featuredimg });
    }

    const regularPrice = ((Number(product.productOriginalPrice) || 0) + 1200).toString()
    // const stock_status = (product.availability === 1 || product.availability === true)
    //   ? "instock"
    //   : "outofstock";

    const isAvailable = (
      product.availability === true ||
      product.availability === 1 ||
      product.availability === "1" ||
      product.availability === "true"
    );

    const stock_status = isAvailable ? "instock" : "outofstock";

    // ✅ Base payload
    const payload = {
      name: product.productName,
      type: "simple",
      regular_price: regularPrice,
      sku,
      description: product.productDescription || "",
      short_description: product.productShortDescription || "",
      stock_status,
      meta_data: [
        { key: "productFetchedFrom", value: product.productFetchedFrom },
        { key: "productUrl", value: product.productUrl },
        { key: "availability", value: product.availability },
        { key: "productOriginalPrice", value: product.productOriginalPrice },
        { key: "featuredimg", value: product.featuredimg.replace("gallery_sm", "gallery_md") },

        { key: "productBrand", value: product.productBrand },
        { key: "productLastUpdated", value: product.productLastUpdated || Date.now() },
        { key: "productShortDescription", value: product.productShortDescription },
        { key: "productDescription", value: product.productDescription },
      ],
    };


    // ✅ Add price, category & brand only for new products
    // if (!existing) { activate after correction finesh
    if (!existing) {
      payload.regular_price = regularPrice;
      payload.sku,
        payload.meta_data.push({
          key: "productDateCreation",
          value: Date.now(),
        });
      payload.meta_data.push({
        key: "productOriginalPrice",
        value: product.productOriginalPrice,
      });

      let imageUrl;
      if (typeof product.imageUrl === "string") {
        // Already a string → just replace
        imageUrl = product.imageUrl.replace("gallery_sm", "gallery_md");
      } else {
        // Not a string → convert to JSON string first, then replace
        imageUrl = JSON.stringify(product.imageUrl || []).replace("gallery_sm", "gallery_md");
      }

      payload.meta_data.push({
        key: "imageUrl",
        value: imageUrl,
      });

      payload.meta_data.push({
        key: "videoUrl",
        value: product.videoUrl || "",
      });

      if (categoryId) payload.categories = [{ id: categoryId }];
      // Directly assign the brand for new products
      if (brandId) payload.brands = [{ id: brandId }];

    }


    const res = await fetch(endpoint, {
      method,
      headers: {
        Authorization: getAuthHeader(site),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (res.ok) {
      console.log(`✅[${site.name}] ${existing ? "Updated" : "Created"}: ${data.name} (ID: ${data.id})`);
    } else {
      console.error("❌ [${site.name}] Error creating/updating product:", data);
    }
  } catch (err) {
    console.error("❌ [${site.name}] Unexpected error:", err);
  }
}



// ---------------- BULK SYNC ----------------
export async function bulkSafeSyncProducts(req, res) {
  console.log("🔄 Starting bulk sync (safe mode) from local DB → WooCommerce...");

  try {


    const rows = await new Promise((resolve, reject) => {
      const currentTimestamp = Date.now(); // Current timestamp in milliseconds
      // const oneDayAgo = currentTimestamp - 100 * 60 * 60 * 1000; // 24 hours ago in milliseconds
      const twelveAndHalfHoursAgo = currentTimestamp - 24 * 60 * 60 * 1000; // 12.5 hours ago in milliseconds


      DB.all(
        "SELECT * FROM PRODUCTS WHERE productLastUpdated >= ? ORDER BY datetime(productLastUpdated / 1000, 'unixepoch') DESC;",
        // "UPDATE PRODUCTS SET availability = 0 WHERE productFetchedFrom IN (    'https://watchhouse11.cartpe.in/',    'https://saenterprise.cartpe.in/',    'https://jilaniwatches11.cartpe.in/',    'https://thetimekeepers.cartpe.in/')",
        // "SELECT * FROM PRODUCTS WHERE productFetchedFrom IN (    'https://watchhouse11.cartpe.in/',    'https://saenterprise.cartpe.in/',    'https://jilaniwatches11.cartpe.in/',    'https://thetimekeepers.cartpe.in/')",


        // [oneDayAgo],
        [twelveAndHalfHoursAgo],
        (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        }
      );
    });

    console.log(`📦 Found ${rows.length} products to sync.`);

    const batchSize = 10;
    const delayMs = 250;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      // console.log(`🚀 Syncing batch ${i / batchSize + 1} (${batch.length} products)...`);
      console.log(`🚀 Syncing batch ${i / batchSize + 1} (${batch.length} products) across ${WP_SITES.length} sites...`);

      // await Promise.all(batch.map((p) => upsertProductSafe(p)));

      const syncPromises = batch.flatMap((p) =>
        WP_SITES.map((site) => upsertProductSafe(p, site))
      );
      await Promise.all(syncPromises);

      console.log(`✅ Batch ${i / batchSize + 1} complete. Waiting ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    console.log("🎉 Bulk safe sync complete!");
    res.send({ status: "success", message: "Bulk safe sync complete" });
    // res.json(rows);

  } catch (err) {
    console.error("❌ DB error:", err);
    res.status(500).send({ error: err.message });
  }
}

export async function BulkProductOutOfStock(req, res) {
  console.log("🔄 Starting bulk sync (safe mode) from local DB → WooCommerce...");

  try {
    const currentTimestamp = Date.now(); // Current timestamp in milliseconds
    // const oneDayAgo = currentTimestamp - 100 * 60 * 60 * 1000; // 24 hours ago in milliseconds
    const threeDays = currentTimestamp - 3 * 24 * 60 * 60 * 1000; // 3 days ago in milliseconds



    //   DB.run(
    //   `UPDATE PRODUCTS SET availability = false WHERE NOT ( productOriginalPrice GLOB '[0-9]*' OR productOriginalPrice GLOB '[0-9]*.[0-9]*' );`,
    //   function (err) {
    //     if (err) {
    //       reject(err);
    //     } else {
    //       console.log("Rows updated:", this.changes);
    //       resolve(this.changes);
    //     }
    //   }
    // );




    DB.run(
      `UPDATE PRODUCTS 
     SET availability = 0, productLastUpdated = ?
     WHERE productLastUpdated <= ?
     AND (availability = 1 OR availability = '1' OR availability = true OR availability = 'true')`,
      [Date.now(), threeDays],
      function (err) {
        if (err) {
          reject(err);
        } else {
          console.log("Rows updated:", this.changes);
          resolve(this.changes);
        }
      }
    );


    const rows = await new Promise((resolve, reject) => {
      const now = Date.now(); // Current timestamp in milliseconds
      const twentymins = now - 20 * 60 * 1000; // 20 mins ago in milliseconds

      DB.all(
        "SELECT * FROM PRODUCTS  WHERE productLastUpdated BETWEEN ? AND ? ORDER BY datetime(productLastUpdated / 1000, 'unixepoch') DESC;",
        [twentymins, now],
        (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        }
      );
    });


    console.log(`📦 Found ${rows.length} products to sync.`);
    res.json(rows);
    const batchSize = 10;
    const delayMs = 250;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      // console.log(`🚀 Syncing batch ${i / batchSize + 1} (${batch.length} products)...`);

      console.log(`🚀 Syncing batch ${i / batchSize + 1} (${batch.length} products) across ${WP_SITES.length} sites...`);
      // await Promise.all(batch.map((p) => upsertProductSafe(p)));

      // 👇 Map over both the batch AND the sites
      const syncPromises = batch.flatMap((p) =>
        WP_SITES.map((site) => upsertProductSafe(p, site))
      );

      // Wait for all products to sync across all sites for this batch
      await Promise.all(syncPromises);

      // console.log(`✅ Batch ${i / batchSize + 1} complete. Waiting ${delayMs}ms...`);
      console.log(`✅ Batch ${i / batchSize + 1} complete. Waiting ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    console.log("🎉 Bulk safe sync complete!");
    // res.send({ status: "success", message: "Bulk safe sync complete" });
  } catch (err) {
    console.error("❌ DB error:", err);
    res.status(500).send({ error: err.message });
  }
}



// Helper to classify product into 'watches' or 'shoes'
function getProductDatabaseType(product) {
    const cat = (product.catName || "").toLowerCase();
    if (cat.includes("shoe") || cat.includes("sneaker") || cat.includes("kicks")) {
        return "shoes";
    }
    // Default fallback to watches
    return "watches"; 
}


// ---------------- FIX BRAND HIERARCHY USING brandMap (single-site) ----------------
// export async function fixBrandsFromMap() {
//   console.log("🔄 Fixing brands hierarchy from brandMap...");

//   try {
//     for (const [parentName, subbrands] of Object.entries(brandMap)) {
//       let parentId = null;

//       // 1️⃣ Ensure parent brand exists
//       const parentSearchRes = await fetch(`${WP_URL}/wp-json/wp/v2/product_brand?search=${encodeURIComponent(parentName)}`, {
//         headers: { Authorization: getAuthHeader() },
//       });
//       const parentData = await parentSearchRes.json();

//       parentId = parentData.find(b => b.name.toLowerCase() === parentName.toLowerCase())?.id || null;

//       if (!parentId) {
//         const createParentRes = await fetch(`${WP_URL}/wp-json/wp/v2/product_brand`, {
//           method: "POST",
//           headers: {
//             Authorization: getAuthHeader(),
//             "Content-Type": "application/json",
//           },
//           body: JSON.stringify({ name: parentName }),
//         });
//         const parent = await createParentRes.json();
//         if (createParentRes.ok) {
//           parentId = parent.id;
//           console.log(`🆕 Created parent brand: ${parentName} (ID: ${parentId})`);
//         } else {
//           console.error("❌ Failed to create parent brand:", parent);
//           continue;
//         }
//       } else {
//         console.log(`✅ Parent brand exists: ${parentName} (ID: ${parentId})`);
//       }

//       // 2️⃣ Loop through subbrands
//       for (const subName of subbrands) {
//         try {
//           const subSearchRes = await fetch(`${WP_URL}/wp-json/wp/v2/product_brand?search=${encodeURIComponent(subName)}`, {
//             headers: { Authorization: getAuthHeader() },
//           });
//           const subData = await subSearchRes.json();

//           // Find exact match
//           const exactSub = subData.find(b => b.name.toLowerCase() === subName.toLowerCase());

//           if (exactSub) {
//             // Force update parent
//             const updateRes = await fetch(`${WP_URL}/wp-json/wp/v2/product_brand/${exactSub.id}`, {
//               method: "PUT",
//               headers: {
//                 Authorization: getAuthHeader(),
//                 "Content-Type": "application/json",
//               },
//               body: JSON.stringify({ parent: parentId }),
//             });
//             const updated = await updateRes.json();
//             if (updateRes.ok) console.log(`🔄 Updated parent for subbrand '${subName}' → '${parentName}'`);
//             else console.error("❌ Failed to update subbrand parent:", updated);
//           } else {
//             // Create subbrand under parent
//             const createSubRes = await fetch(`${WP_URL}/wp-json/wp/v2/product_brand`, {
//               method: "POST",
//               headers: {
//                 Authorization: getAuthHeader(),
//                 "Content-Type": "application/json",
//               },
//               body: JSON.stringify({ name: subName, parent: parentId }),
//             });
//             const newSub = await createSubRes.json();
//             if (createSubRes.ok) console.log(`🆕 Created subbrand '${subName}' under '${parentName}'`);
//             else console.error("❌ Failed to create subbrand:", newSub);
//           }
//         } catch (err) {
//           console.error(`❌ Error processing subbrand '${subName}':`, err);
//         }
//       }
//     }

//     console.log("🎉 Brand hierarchy updated successfully!");
//   } catch (err) {
//     console.error("❌ Error fixing brands from brandMap:", err);
//   }
// }

// ---------------- FIX BRAND HIERARCHY USING brandMap (multi-site) ----------------

export async function fixBrandsFromMap() {
  console.log("🔄 Fixing brands hierarchy from brandMap across all sites...");

  try {
    for (const site of WP_SITES) { // <-- ADDED LOOP FOR SITES
      console.log(`\n🌐 Processing brands for site: ${site.name}`);

      for (const [parentName, subbrands] of Object.entries(brandMap)) {
        let parentId = null;

        // 1️⃣ Ensure parent brand exists
        const parentSearchRes = await fetch(`${site.url}/wp-json/wp/v2/product_brand?search=${encodeURIComponent(parentName)}`, {
          headers: { Authorization: getAuthHeader(site) }, // <-- Pass site
        });
        const parentData = await parentSearchRes.json();

        parentId = parentData.find(b => b.name.toLowerCase() === parentName.toLowerCase())?.id || null;

        if (!parentId) {
          const createParentRes = await fetch(`${site.url}/wp-json/wp/v2/product_brand`, {
            method: "POST",
            headers: {
              Authorization: getAuthHeader(site), // <-- Pass site
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: parentName }),
          });
          const parent = await createParentRes.json();
          if (createParentRes.ok) {
            parentId = parent.id;
            console.log(`🆕 [${site.name}] Created parent brand: ${parentName} (ID: ${parentId})`);
          } else {
            console.error(`❌ [${site.name}] Failed to create parent brand:`, parent);
            continue;
          }
        } else {
          console.log(`✅[${site.name}] Parent brand exists: ${parentName} (ID: ${parentId})`);
        }

        // 2️⃣ Loop through subbrands
        for (const subName of subbrands) {
          try {
            const subSearchRes = await fetch(`${site.url}/wp-json/wp/v2/product_brand?search=${encodeURIComponent(subName)}`, {
              headers: { Authorization: getAuthHeader(site) }, // <-- Pass site
            });
            const subData = await subSearchRes.json();

            // Find exact match
            const exactSub = subData.find(b => b.name.toLowerCase() === subName.toLowerCase());

            if (exactSub) {
              // Force update parent
              const updateRes = await fetch(`${site.url}/wp-json/wp/v2/product_brand/${exactSub.id}`, {
                method: "PUT",
                headers: {
                  Authorization: getAuthHeader(site), // <-- Pass site
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ parent: parentId }),
              });
              const updated = await updateRes.json();
              if (updateRes.ok) console.log(`🔄 [${site.name}] Updated parent for subbrand '${subName}' → '${parentName}'`);
              else console.error(`❌[${site.name}] Failed to update subbrand parent:`, updated);
            } else {
              // Create subbrand under parent
              const createSubRes = await fetch(`${site.url}/wp-json/wp/v2/product_brand`, {
                method: "POST",
                headers: {
                  Authorization: getAuthHeader(site), // <-- Pass site
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ name: subName, parent: parentId }),
              });
              const newSub = await createSubRes.json();
              if (createSubRes.ok) console.log(`🆕[${site.name}] Created subbrand '${subName}' under '${parentName}'`);
              else console.error(`❌ [${site.name}] Failed to create subbrand:`, newSub);
            }
          } catch (err) {
            console.error(`❌ [${site.name}] Error processing subbrand '${subName}':`, err);
          }
        }
      }
    }
    console.log("🎉 Brand hierarchy updated successfully on all sites!");
  } catch (err) {
    console.error("❌ Error fixing brands from brandMap:", err);
  }
}
