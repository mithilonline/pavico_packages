// Pavico: "Convert to Lead" on received emails. Creates (or finds) a CRM Lead for the sender
// and links this email to it, so it shows in the lead's activity.
frappe.ui.form.on('Communication', {
	refresh(frm) {
		const d = frm.doc;
		if (d.communication_medium !== 'Email' || d.sent_or_received !== 'Received' || frm.is_new()) return;
		if (d.reference_doctype === 'CRM Lead' && d.reference_name) {
			frm.add_custom_button(__('Open Lead'), () => window.open(`/crm/leads/${encodeURIComponent(d.reference_name)}`, '_blank'));
			return;
		}
		frm.add_custom_button(__('Convert to Lead'), async () => {
			const email = String(d.sender || '').trim().toLowerCase();
			if (!email) { frappe.msgprint(__('This email has no sender address.')); return; }
			const existing = await frappe.db.get_value('CRM Lead', { email }, 'name');
			let lead = existing && existing.message && existing.message.name;
			if (!lead) {
				const full = (d.sender_full_name || email.split('@')[0]).trim();
				const [first, ...rest] = full.split(/\s+/);
				const doc = await frappe.db.insert({
					doctype: 'CRM Lead', first_name: first, last_name: rest.join(' '), email,
					status: 'New', source: 'Email',
				});
				lead = doc.name;
			}
			await frappe.db.set_value('Communication', d.name, { reference_doctype: 'CRM Lead', reference_name: lead });
			frappe.show_alert({ message: existing && existing.message && existing.message.name ? __('Linked to existing lead {0}', [lead]) : __('Lead {0} created', [lead]), indicator: 'green' });
			frm.reload_doc();
		}).addClass('btn-primary');
	},
});
