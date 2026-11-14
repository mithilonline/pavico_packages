"""Server side of the Package Builder. The page calls these methods; ERPNext checks the user's permissions on every one."""

import base64
import json
import re

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

TIERS = {"budget": "Budget", "mid": "Mid-luxury", "luxury": "Luxury"}
RATE_FIELDS = ("hotel", "source", "rate", "cab", "act", "extra_bed", "vehicle_rates")
QUOTES_IN_BOOT = 200


def _parse(value):
	return json.loads(value) if isinstance(value, str) else (value or {})


def get_boot():
	"""Everything the builder page needs at load time, read with the user's own permissions."""
	quotes = []
	for q in frappe.get_list(
		"Travel Quote",
		fields=["ref", "version", "client_name", "package_title", "total", "modified", "state_json"],
		order_by="modified desc",
		limit_page_length=QUOTES_IN_BOOT,
	):
		quotes.append(
			{
				"ref": q.ref,
				"version": cint(q.version) or 1,
				"client": q.client_name or "",
				"title": q.package_title or "",
				"total": flt(q.total),
				"savedAt": int(q.modified.timestamp() * 1000),
				"state": _parse(q.state_json),
			}
		)

	rates = {}
	for r in frappe.get_list("Pavico Rate", fields=["city_id", "tier", *RATE_FIELDS], limit_page_length=0):
		rates.setdefault(r.city_id, {})[r.tier] = {
			"hotel": r.hotel or "",
			"source": r.source or "ratesheet",
			"rate": flt(r.rate),
			"cab": flt(r.cab),
			"act": flt(r.act),
			"xbed": flt(r.extra_bed),
			"vehicles": _parse(r.vehicle_rates or "{}"),
		}

	picks, photos, hidden = {}, {}, {}
	for n in frappe.get_list(
		"Attraction Note", fields=["attraction_key", "pavico_pick", "hide_photo", "photo"], limit_page_length=0
	):
		if n.pavico_pick:
			picks[n.attraction_key] = True
		if n.photo:
			photos[n.attraction_key] = n.photo
		elif n.hide_photo:
			hidden[n.attraction_key] = True

	return {"quotes": quotes, "rates": rates, "picks": picks, "photos": photos, "hidden": hidden}


@frappe.whitelist()
def bootstrap():
	return get_boot()


# ───────────── quotes ─────────────
@frappe.whitelist(methods=["POST"])
def save_quote(entry):
	entry = _parse(entry)
	state = entry.get("state") or {}
	ref = entry.get("ref")
	if not ref:
		frappe.throw(_("The quote has no reference"))

	version = cint(entry.get("version")) or 1
	name = f"{ref}-v{version}"
	if frappe.db.exists("Travel Quote", name):
		doc = frappe.get_doc("Travel Quote", name)
	else:
		doc = frappe.new_doc("Travel Quote")
		doc.ref = ref
		doc.version = version

	client = (entry.get("client") or state.get("client") or "").strip()
	phone = (state.get("phone") or "").strip()
	customer = state.get("customer") or ""
	contact = state.get("contact") or ""
	if customer and not frappe.db.exists("Customer", customer):
		customer = ""
	if contact and not frappe.db.exists("Contact", contact):
		contact = ""
	if not customer and not contact and client:
		contact = _find_or_create_contact(client, phone)
	if contact and not customer:
		customer = frappe.db.get_value(
			"Dynamic Link", {"parenttype": "Contact", "parent": contact, "link_doctype": "Customer"}, "link_name"
		) or ""
	state["customer"], state["contact"] = customer, contact

	travellers = cint(state.get("adults")) + cint(state.get("children"))
	doc.update(
		{
			"client_name": client,
			"phone": phone,
			"customer": customer or None,
			"contact": contact or None,
			"package_title": entry.get("title") or "",
			"destination": (state.get("customDest") or {}).get("name") or state.get("destId") or "",
			"start_date": getdate(state["startDate"]) if state.get("startDate") else None,
			"end_date": getdate(entry["endDate"]) if entry.get("endDate") else None,
			"travellers": travellers,
			"tier": TIERS.get(state.get("tier"), ""),
			"discount": flt(entry.get("discount")),
			"total": flt(entry.get("total")),
			"state_json": json.dumps(state),
		}
	)
	doc.save()  # checks the user's write/create permission
	return {"name": doc.name, "customer": customer, "contact": contact}


def _find_or_create_contact(client, phone):
	"""A new client becomes an ERPNext Contact (matched by mobile number first, so no duplicates)."""
	digits = re.sub(r"\D", "", phone or "")[-10:]
	if digits:
		match = frappe.get_all(
			"Contact", or_filters=[["mobile_no", "like", f"%{digits}"], ["phone", "like", f"%{digits}"]], pluck="name", limit=1
		)
		if match:
			return match[0]
	first, _sep, last = client.partition(" ")
	contact = frappe.get_doc({"doctype": "Contact", "first_name": first, "last_name": last})
	if phone:
		contact.append("phone_nos", {"phone": phone, "is_primary_mobile_no": 1})
	contact.insert()  # checks the user's create permission on Contact
	return contact.name


# ───────────── clients: ERPNext customers and contacts ─────────────
@frappe.whitelist()
def search_clients(txt):
	txt = (txt or "").strip()
	if len(txt) < 2:
		return []
	like = f"%{txt}%"
	out = []
	for c in frappe.get_list(
		"Customer",
		or_filters=[["customer_name", "like", like], ["mobile_no", "like", like]],
		fields=["name", "customer_name", "mobile_no", "customer_primary_contact"],
		limit_page_length=8,
	):
		phone = c.mobile_no or (
			frappe.db.get_value("Contact", c.customer_primary_contact, "mobile_no") if c.customer_primary_contact else ""
		)
		out.append(
			{"type": "Customer", "title": c.customer_name, "customer": c.name, "contact": c.customer_primary_contact or "", "phone": phone or ""}
		)
	for ct in frappe.get_list(
		"Contact",
		or_filters=[["full_name", "like", like], ["mobile_no", "like", like], ["phone", "like", like]],
		fields=["name", "full_name", "mobile_no", "phone"],
		limit_page_length=8,
	):
		if any(o["contact"] == ct.name for o in out):
			continue
		cust = frappe.db.get_value("Dynamic Link", {"parenttype": "Contact", "parent": ct.name, "link_doctype": "Customer"}, "link_name")
		out.append(
			{"type": "Contact", "title": ct.full_name or ct.name, "contact": ct.name, "customer": cust or "", "phone": ct.mobile_no or ct.phone or ""}
		)
	return out[:12]


# ───────────── client PDF ─────────────
_BLOCKED_TAGS = re.compile(r"<\s*(script|iframe|frame|frameset|object|embed|base|form|input|textarea|video|audio)\b[^>]*>(.*?<\s*/\s*\1\s*>)?", re.I | re.S)
_LINK_TAG = re.compile(r"<\s*link\b[^>]*>", re.I)
_META_REFRESH = re.compile(r"<\s*meta\b[^>]*http-equiv[^>]*>", re.I)


def _clean_pdf_html(html):
	html = _BLOCKED_TAGS.sub("", html)
	html = _LINK_TAG.sub(lambda m: m.group(0) if "fonts.googleapis.com" in m.group(0) else "", html)
	html = _META_REFRESH.sub("", html)
	# no local files and no script URLs, in attributes or CSS
	return re.sub(r"(?i)\b(file|javascript|chrome|view-source)\s*:", "blocked:", html)


@frappe.whitelist(methods=["POST"])
def quote_pdf(html, filename="Pavico-quote.pdf"):
	"""Renders the quote page with the server's Chromium: real text, A4, footer with quote no. and page numbers."""
	import os
	import shutil
	import subprocess
	import tempfile

	if not frappe.has_permission("Travel Quote", "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if not html or len(html) > 8 * 1024 * 1024:
		frappe.throw(_("The quote is empty or too large"))
	chromium = frappe.conf.get("chromium_path") or shutil.which("chromium-headless-shell") or shutil.which("chromium")
	if not chromium:
		frappe.throw(_("Chromium is not installed on the server"))
	with tempfile.TemporaryDirectory() as d:
		src, out = os.path.join(d, "quote.html"), os.path.join(d, "quote.pdf")
		with open(src, "w", encoding="utf-8") as f:
			f.write(_clean_pdf_html(html))
		subprocess.run(
			[
				chromium, "--headless", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer",
				"--blink-settings=scriptEnabled=false", "--virtual-time-budget=15000",
				f"--print-to-pdf={out}", f"file://{src}",
			],
			capture_output=True, timeout=120, check=False,
		)
		if not os.path.exists(out) or os.path.getsize(out) < 500:
			frappe.throw(_("The PDF could not be made. Please try again."))
		with open(out, "rb") as f:
			data = f.read()
	frappe.local.response.filename = re.sub(r"[^A-Za-z0-9._-]+", "-", filename or "Pavico-quote.pdf")[:150]
	frappe.local.response.filecontent = data
	frappe.local.response.type = "download"


@frappe.whitelist(methods=["POST"])
def delete_quote(ref, version=0):
	"""Deletes one version, or every version of the quote when version is 0."""
	filters = {"ref": ref}
	if cint(version):
		filters["version"] = cint(version)
	for name in frappe.get_all("Travel Quote", filters=filters, pluck="name"):
		frappe.delete_doc("Travel Quote", name)  # checks the user's delete permission
	return {"ok": True}


# ───────────── rate sheet ─────────────
@frappe.whitelist(methods=["POST"])
def set_rate(city_id, tier, rate, city_name=None):
	rate = _parse(rate)
	if tier not in TIERS:
		frappe.throw(_("Unknown tier {0}").format(tier))
	name = frappe.db.get_value("Pavico Rate", {"city_id": city_id, "tier": tier})
	doc = frappe.get_doc("Pavico Rate", name) if name else frappe.new_doc("Pavico Rate")
	doc.update({"city_id": city_id, "tier": tier})
	if city_name:
		doc.city_name = city_name
	doc.hotel = rate.get("hotel") or ""
	doc.source = rate.get("source") or "ratesheet"
	for f in ("rate", "cab", "act"):
		doc.set(f, flt(rate.get(f)))
	if any(flt(v) < 0 for v in [rate.get("rate"), rate.get("cab"), rate.get("act"), rate.get("xbed"), *(rate.get("vehicles") or {}).values()]):
		frappe.throw(_("Rates can't be negative"))
	doc.extra_bed = flt(rate.get("xbed"))
	doc.vehicle_rates = json.dumps({k: flt(v) for k, v in (rate.get("vehicles") or {}).items() if flt(v) > 0})
	doc.save()
	return {"name": doc.name}


# ───────────── attraction notes: Pavico picks and team photos ─────────────
def _note(key, city=None, attraction=None):
	key = (key or "").strip().lower()
	if not key:
		frappe.throw(_("Missing attraction"))
	name = frappe.db.get_value("Attraction Note", {"attraction_key": key})
	doc = frappe.get_doc("Attraction Note", name) if name else frappe.new_doc("Attraction Note")
	doc.attraction_key = key
	if city:
		doc.city = city
	if attraction:
		doc.attraction = attraction
	return doc


@frappe.whitelist(methods=["POST"])
def set_pick(key, on, city=None, attraction=None):
	doc = _note(key, city, attraction)
	doc.pavico_pick = cint(on)
	doc.save()
	return {"ok": True}


@frappe.whitelist(methods=["POST"])
def set_photo(key, image, city=None, attraction=None):
	"""image is a data URL (the builder already shrinks it to 640px JPEG)."""
	header, _sep, payload = (image or "").partition(",")
	if not header.startswith("data:image/") or not payload:
		frappe.throw(_("Please upload an image"))
	content = base64.b64decode(payload)
	if len(content) > 2 * 1024 * 1024:
		frappe.throw(_("The photo is too large"))

	doc = _note(key, city, attraction)
	doc.hide_photo = 0
	doc.save()
	ext = "png" if "image/png" in header else "jpg"
	file = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{re.sub(r'[^a-z0-9]+', '-', (attraction or 'attraction').lower()).strip('-')[:40]}-{doc.name}.{ext}",
			"content": content,
			"attached_to_doctype": "Attraction Note",
			"attached_to_name": doc.name,
			"attached_to_field": "photo",
			"is_private": 0,
		}
	)
	file.save()
	doc.db_set("photo", file.file_url)
	return {"url": file.file_url}


@frappe.whitelist(methods=["POST"])
def hide_photo(key, city=None, attraction=None):
	doc = _note(key, city, attraction)
	doc.photo = None
	doc.hide_photo = 1
	doc.save()
	return {"ok": True}
