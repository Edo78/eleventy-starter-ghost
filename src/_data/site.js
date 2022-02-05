require("dotenv").config();
const {AssetCache} = require("@11ty/eleventy-cache-assets");
const ghostContentAPI = require("@tryghost/content-api");

// Init Ghost API
const api = new ghostContentAPI({
  url: process.env.GHOST_API_URL,
  key: process.env.GHOST_CONTENT_API_KEY,
  version: "v4"
});

const cacheAPI = {
  'ghost_settings': api.settings.browse,
}

const cacheWrapper = async (key, duration, ...arguments) => {
  const cacheKey = `${key}_${JSON.stringify(arguments)}`;
  if (cacheAPI[key]) {
    let asset = new AssetCache(cacheKey);
    if (asset.isCacheValid(duration)) {
      return asset.getCachedValue();
    }

    try {
      let value = await cacheAPI[key](...arguments);
      asset.save(value, 'json');
      return value;
    } catch (error) {
      return asset.getCachedValue();
    }
  }
}

// Get all site information
module.exports = async function() {
  const siteData = await cacheWrapper('ghost_settings', '10m');

  if (process.env.SITE_URL) siteData.url = process.env.SITE_URL;

  return siteData;
};
