# Pavico Packages (ERPNext app)

The Pavico Package Builder running inside ERPNext. The team logs in to ERPNext and opens **/package-builder**.

## What ERPNext gives it

| In the builder | Stored in ERPNext as |
|---|---|
| Saved quotes | **Travel Quote** (client, phone, package, dates, travellers, tier, total, status Draft / Sent / Won / Lost, link to a Customer) |
| Rate sheet | **Pavico Rate**, one row per city and tier. Can be edited and imported in bulk in Desk (Data Import) |
| ★ Pavico picks, team photos, hidden photos | **Attraction Note** (photos are ERPNext files) |

Who can use it: users with the **Sales User**, **Sales Manager** or **System Manager** role. Sales Users can't delete rates or attraction notes.

Still per browser: the quote being edited (draft) and the Wikipedia / Wikivoyage caches.

## Install (self-hosted bench)

```bash
cd ~/frappe-bench
bench get-app /path/to/pavico_packages     # or a private git URL
bench --site your.site install-app pavico_packages
bench build --app pavico_packages
bench --site your.site migrate
```

Then open `https://your.site/package-builder`.

**Frappe Cloud:** custom apps need a private bench. Push this folder to a private GitHub repo, add it to the bench, deploy, then install it on the site.

## Updating the front end

The builder's screens are the same files as `prototype/`. After changing the prototype, run `erp/sync-builder.ps1` to copy them into `public/builder/`, then `bench build --app pavico_packages` (or redeploy).
