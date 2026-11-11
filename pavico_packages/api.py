"""Server side of the Package Builder. The page calls these methods; ERPNext checks the user's permissions on every one."""

import base64
import json
import re

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

TIERS = {"budget": "Budget", "mid": "Mid-luxury", "luxury": "Luxury"}
RATE_FIELDS = ("hotel", "source", "rate", "cab", "act")
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

	travellers = cint(state.get("adults")) + cint(state.get("children"))
	doc.update(
		{
			"client_name": entry.get("client") or state.get("client") or "",
			"phone": state.get("phone") or "",
			"package_title": entry.get("title") or "",
			"destination": (state.get("customDest") or {}).get("name") or state.get("destId") or "",
			"start_date": getdate(state["startDate"]) if state.get("startDate") else None,
			"travellers": travellers,
			"tier": TIERS.get(state.get("tier"), ""),
			"total": flt(entry.get("total")),
			"state_json": json.dumps(state),
		}
	)
	doc.save()  # checks the user's write/create permission
	return {"name": doc.name}


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
