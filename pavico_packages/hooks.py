app_name = "pavico_packages"
app_title = "Pavico Packages"
app_publisher = "Pavico LLP"
app_description = "Package Builder inside ERPNext: itineraries, rate sheet and travel quotes"
app_email = "support@pavico.in"
app_license = "Proprietary"

required_apps = ["erpnext"]

# The builder page lives at /package-builder (www/pavico_builder.html)
website_route_rules = [{"from_route": "/package-builder", "to_route": "pavico_builder"}]

# Tile on the /apps screen (Frappe v15+)
add_to_apps_screen = [
	{
		"name": "pavico_packages",
		"logo": "/assets/pavico_packages/builder/img/logo.png",
		"title": "Package Builder",
		"route": "/package-builder",
	}
]

# WhatsApp AI assistant: every incoming customer message queues a reply job (see whatsapp_ai.py)
doc_events = {
	"WhatsApp Message": {
		"after_insert": "pavico_packages.whatsapp_ai.on_whatsapp_message",
	}
}

# "Convert to Lead" / "Open Lead" on received emails
doctype_js = {"Communication": "public/js/communication.js"}
