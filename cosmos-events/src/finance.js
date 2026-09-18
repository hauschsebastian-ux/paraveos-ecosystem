'use strict';
// Gagenberechnung: DJ-Gage = Buchungswert − Cosmos-Provision − Leihgebühren.
const { getDb } = require('./db');

function financeForEvent(ev, paidOutCents = null) {
  const booking = ev.booking_value_cents || 0;
  const commission = Math.round(booking * (ev.commission_percent || 0) / 100);
  const rental = ev.rental_fee_cents || 0;
  const fee = Math.max(0, booking - commission - rental);
  let paid = paidOutCents;
  if (paid === null) {
    paid = getDb().prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM payouts WHERE event_id = ?').get(ev.id).s;
  }
  return {
    booking_value_cents: booking,
    commission_percent: ev.commission_percent || 0,
    commission_cents: commission,
    rental_fee_cents: rental,
    dj_fee_cents: fee,
    paid_out_cents: paid,
    open_cents: Math.max(0, fee - paid),
    customer_payment_status: ev.customer_payment_status,
  };
}

function summaryForDj(djId, year = null) {
  const db = getDb();
  const where = ["e.dj_id = ?", "e.status != 'storniert'"];
  const params = [djId];
  if (year) { where.push("substr(e.event_date,1,4) = ?"); params.push(String(year)); }
  const events = db.prepare(`
    SELECT e.*, c.name AS customer_name,
           (SELECT COALESCE(SUM(amount_cents),0) FROM payouts p WHERE p.event_id = e.id) AS paid_out_cents
      FROM events e LEFT JOIN users c ON c.id = e.customer_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.event_date IS NULL, e.event_date`).all(...params);
  const rows = events.map((e) => ({
    id: e.id, title: e.title, event_date: e.event_date, status: e.status, location_name: e.location_name,
    customer_name: e.customer_name, ...financeForEvent(e, e.paid_out_cents),
  }));
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const done = rows.filter((r) => r.status === 'abgeschlossen');
  return {
    events: rows,
    kpis: {
      event_count: rows.length,
      completed_count: done.length,
      upcoming_count: rows.filter((r) => r.status !== 'abgeschlossen').length,
      total_booking_cents: sum('booking_value_cents'),
      total_commission_cents: sum('commission_cents'),
      total_rental_cents: sum('rental_fee_cents'),
      total_fee_cents: sum('dj_fee_cents'),
      paid_out_cents: sum('paid_out_cents'),
      open_cents: sum('open_cents'),
      open_completed_cents: done.reduce((a, r) => a + r.open_cents, 0),
    },
    years: db.prepare("SELECT DISTINCT substr(event_date,1,4) AS y FROM events WHERE dj_id = ? AND event_date IS NOT NULL ORDER BY y DESC").all(djId).map((r) => r.y),
  };
}

module.exports = { financeForEvent, summaryForDj };
