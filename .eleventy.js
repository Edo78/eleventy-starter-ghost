require("dotenv").config();

const cleanCSS = require("clean-css");
const fs = require("fs");
const pluginRSS = require("@11ty/eleventy-plugin-rss");
const ghostContentAPI = require("@tryghost/content-api");
const {AssetCache} = require("@11ty/eleventy-cache-assets");
const Image = require("@11ty/eleventy-img");
const slugify = require("@sindresorhus/slugify");
const safeLinks = require('@sardine/eleventy-plugin-external-links');
const htmlMinTransform = require("./src/transforms/html-min-transform.js");

// Init Ghost API
const api = new ghostContentAPI({
  url: process.env.GHOST_API_URL,
  key: process.env.GHOST_CONTENT_API_KEY,
  version: "v4"
});

const cacheAPI = {
  'ghost_authors': api.authors.browse,
  'ghost_tags': api.tags.browse,
  'ghost_posts': api.posts.browse,
  'ghost_pages': api.pages.browse,
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

// Strip Ghost domain from urls
const stripDomain = url => {
  return url.replace(process.env.GHOST_API_URL, "");
};

const imageShortcode = (src, cls, alt, sizes, widths) => {
  src = src.startsWith('//www.gravatar.com/') ? `https:${src}` : src;
  // escape double quotes from alt text
  alt = alt.replace(/"/g, '&quot;');
  const options = {
    customName: slugify(alt),
    widths,
    formats: ["webp", "jpeg"],
    outputDir: "./dist/img",
    cacheOptions: {
      // if a remote image URL, this is the amount of time before it fetches a fresh copy
      duration: "30d",
      // project-relative path to the cache directory
      directory: ".cache",
      removeUrlQueryParams: false,
    },
    filenameFormat: function (id, src, width, format, options) {
      return `${options.customName}-${width}.${format}`;
    }
  };

  // generate images, while this is async we don’t wait
  Image(src, options);

  let imageAttributes = {
    class: cls,
    alt,
    sizes,
    loading: "lazy",
    decoding: "async",
  };
  // get metadata even the images are not fully generated
  let metadata = Image.statsByDimensionsSync(src, Math.max(...widths), null, options);
  // You bet we throw an error on missing alt in `imageAttributes` (alt="" works okay)
  return Image.generateHTML(metadata, imageAttributes);
}

module.exports = function(config) {
  // Minify HTML
  config.addTransform("htmlmin", htmlMinTransform);

  // Assist RSS feed template
  config.addPlugin(pluginRSS);

  // Add safe links
  config.addPlugin(safeLinks);

  // Add 'image' shortcode
  config.addNunjucksShortcode("image", imageShortcode);
  config.addLiquidShortcode("image", imageShortcode);
  config.addJavaScriptFunction("image", imageShortcode);

  // Inline CSS
  config.addFilter("cssmin", code => {
    return new cleanCSS({}).minify(code).styles;
  });

  config.addFilter("getReadingTime", text => {
    const wordsPerMinute = 200;
    const numberOfWords = text.split(/\s/g).length;
    return Math.ceil(numberOfWords / wordsPerMinute);
  });

  // Date formatting filter
  config.addFilter("htmlDateString", dateObj => {
    return new Date(dateObj).toISOString().split("T")[0];
  });

  // Don't ignore the same files ignored in the git repo
  config.setUseGitIgnore(false);

  // Get all pages tagged with 'footer'
  config.addCollection("footers", async function(collection) {
    collection = await cacheWrapper("ghost_pages", "30d", {
      include: "authors",
      limit: "all",
      filter: "tag:hash-footer",
    });
    
    collection.map(footer => {
      footer.url = stripDomain(footer.url);
      footer.primary_author.url = stripDomain(footer.primary_author.url);

      // Convert publish date into a Date object
      footer.published_at = new Date(footer.published_at);
      return footer;
    });

    return collection;
  });

  // Get all pages, called 'docs' to prevent
  // conflicting the eleventy page object
  config.addCollection("docs", async function(collection) {
    collection = await cacheWrapper("ghost_pages", "10d", {
      include: "authors",
      limit: "all",
    });
  
    collection.map(doc => {
      doc.url = stripDomain(doc.url);
      doc.primary_author.url = stripDomain(doc.primary_author.url);

      // Convert publish date into a Date object
      doc.published_at = new Date(doc.published_at);
      return doc;
    });

    return collection;
  });

  // Get all posts
  config.addCollection("posts", async function(collection) {
    collection = await cacheWrapper("ghost_posts", "1d", {
      include: "tags,authors",
      limit: "all"
    });

    collection.forEach(post => {
      post.url = stripDomain(post.url);
      post.primary_author.url = stripDomain(post.primary_author.url);
      post.tags.map(tag => (tag.url = stripDomain(tag.url)));

      // Convert publish date into a Date object
      post.published_at = new Date(post.published_at);
    });

    // Bring featured post to the top of the list
    collection.sort((post, nextPost) => nextPost.featured - post.featured);

    return collection;
  });

  // Get all authors
  config.addCollection("authors", async function(collection) {
    collection = await cacheWrapper("ghost_authors", "10d", {
      limit: "all"
    });
      
    // Get all posts with their authors attached
    const posts = await cacheWrapper("ghost_posts", "1d", {
      include: "authors",
      limit: "all"
    });
      
    // Attach posts to their respective authors
    collection.forEach(async author => {
      const authorsPosts = posts.filter(post => {
        post.url = stripDomain(post.url);
        return post.primary_author.id === author.id;
      });
      if (authorsPosts.length) author.posts = authorsPosts;

      author.url = stripDomain(author.url);
    });

    return collection;
  });

  // Get all tags
  config.addCollection("tags", async function(collection) {
    collection = await cacheWrapper("ghost_tags", "1d", {
      include: "count.posts",
      limit: "all"
    });
      
    // Get all posts with their tags attached
    const posts = await cacheWrapper("ghost_posts", "1d", {
      include: "tags,authors",
      limit: "all"
    });
    
    // Attach posts to their respective tags
    collection.forEach(async tag => {
      const taggedPosts = posts.filter(post => {
        post.url = stripDomain(post.url);
        const tagIds = post.tags.map(tag => tag.id);
        return tagIds && tagIds.includes(tag.id);
      });
      if (taggedPosts.length) tag.posts = taggedPosts;

      tag.url = stripDomain(tag.url);
    });

    return collection;
  });

  // Display 404 page in BrowserSnyc
  config.setBrowserSyncConfig({
    callbacks: {
      ready: (err, bs) => {
        const content_404 = fs.readFileSync("dist/404.html");

        bs.addMiddleware("*", (req, res) => {
          // Provides the 404 content without redirect.
          res.write(content_404);
          res.end();
        });
      }
    }
  });

  // Eleventy configuration
  return {
    dir: {
      input: "src",
      output: "dist"
    },

    // Files read by Eleventy, add as needed
    templateFormats: ["css", "njk", "md", "txt"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    passthroughFileCopy: true
  };
};
