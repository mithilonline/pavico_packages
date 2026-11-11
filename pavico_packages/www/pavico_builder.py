import frappe
from frappe import _

import pavico_packages
from pavico_packages.api import get_boot

no_cache = 1
ALLOWED_ROLES = {"Sales User", "Sales Manager", "System Manager"}


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/package-builder"
		raise frappe.Redirect

	if not ALLOWED_ROLES.intersection(frappe.get_roles()):
		frappe.throw(_("The Package Builder is for the Pavico team (Sales User role)."), frappe.PermissionError)

	# JSON for an inline <script>: "</" is escaped so text in a quote can't close the tag
	context.boot_json = frappe.as_json(get_boot(), indent=None).replace("</", "<\\/")
	context.csrf = frappe.sessions.get_csrf_token()
	context.user_name = frappe.utils.get_fullname(frappe.session.user)
	context.v = pavico_packages.__version__
	return context
