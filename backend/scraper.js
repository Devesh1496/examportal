// scraper.js — Scrapes exam websites for new question paper PDFs
const axios = require('axios');
const cheerio = require('cheerio');
const { chromium } = require('playwright');

// ─── WEBSITE CONFIGURATIONS ──────────────────────────────────
// Add new websites here — the scraper handles all of them
const WEBSITES = [
  {
    id: 'rssb',
    name: 'RSSB Rajasthan',
    baseUrl: 'https://rssb.rajasthan.gov.in',
    examDashboardUrl: 'https://rssb.rajasthan.gov.in/examdashboard',
    pdfPattern: /questionpaper/i,
    useBrowser: false, // set true for JS-heavy sites
    parseLinks: async (html, baseUrl) => {
      const $ = cheerio.load(html);
      const links = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if (href.match(/\.pdf/i) || href.match(/questionpaper/i)) {
          const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
          links.push({ url: fullUrl, title: text || 'Question Paper' });
        }
      });
      return links;
    },
  },
  {
    id: 'rpsc',
    name: 'RPSC Rajasthan',
    baseUrl: 'https://rpsc.rajasthan.gov.in',
    examDashboardUrl: 'https://rpsc.rajasthan.gov.in/examdashboard',
    pdfPattern: /question|paper/i,
    useBrowser: true, // RPSC uses JS rendering
    parseLinks: async (html, baseUrl) => {
      const $ = cheerio.load(html);
      const links = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if (href.match(/\.pdf/i)) {
          const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
          links.push({ url: fullUrl, title: text || 'Question Paper' });
        }
      });
      return links;
    },
  },
];

// ─── FETCH HTML ──────────────────────────────────────────────
async function fetchHtml(url, useBrowser = false) {
  if (!useBrowser) {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    return res.data;
  }

  // Use headless browser for JS-heavy sites
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

// ─── SCRAPE A SINGLE WEBSITE ─────────────────────────────────
async function scrapeWebsite(site) {
  console.log(`[Scraper] Scraping ${site.name} — ${site.examDashboardUrl}`);
  try {
    const html = await fetchHtml(site.examDashboardUrl, site.useBrowser);
    const links = await site.parseLinks(html, site.baseUrl);
    console.log(`[Scraper] Found ${links.length} PDF links on ${site.name}`);
    return links.map(l => ({ ...l, website: site.id, websiteName: site.name }));
  } catch (err) {
    console.error(`[Scraper] Error scraping ${site.name}:`, err.message);
    return [];
  }
}

// ─── SCRAPE ALL WEBSITES ─────────────────────────────────────
async function scrapeAll() {
  const results = [];
  for (const site of WEBSITES) {
    const links = await scrapeWebsite(site);
    results.push(...links);
  }
  return results;
}

// ─── SCRAPE CUSTOM URL ───────────────────────────────────────
async function scrapeCustomUrl(url) {
  console.log(`[Scraper] Scraping custom URL: ${url}`);
  try {
    const baseUrl = new URL(url).origin;
    const html = await fetchHtml(url, false);
    const $ = cheerio.load(html);
    const links = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (href.match(/\.pdf/i)) {
        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
        links.push({ url: fullUrl, title: text || 'Question Paper', website: 'custom' });
      }
    });
    // If URL itself is a PDF
    if (url.match(/\.pdf$/i)) {
      links.push({ url, title: 'Question Paper', website: 'custom' });
    }
    return links;
  } catch (err) {
    console.error(`[Scraper] Error on custom URL:`, err.message);
    return [];
  }
}

module.exports = { scrapeAll, scrapeCustomUrl, WEBSITES };
