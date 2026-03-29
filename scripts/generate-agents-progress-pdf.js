'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { runAllAgents } = require('../api/_lib/growth-engine');

function writeLine(doc, label, value, options) {
  const opts = options || {};
  doc.font(opts.labelFont || 'Helvetica-Bold').fontSize(opts.labelSize || 11).fillColor(opts.labelColor || '#c9a84c').text(label);
  doc.moveDown(0.1);
  doc.font(opts.valueFont || 'Helvetica').fontSize(opts.valueSize || 10).fillColor(opts.valueColor || '#e8e0d0').text(value);
  doc.moveDown(opts.gap || 0.6);
}

async function main() {
  const report = await runAllAgents();
  const outDir = path.join(__dirname, '..', 'outputs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'agents-progress.pdf');

  const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: 'AL-MUDIR Agents Progress' } });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0e1114');
  doc.fillColor('#c9a84c').font('Helvetica-Bold').fontSize(24).text('AL-MUDIR Growth Engine', 42, 40);
  doc.fillColor('#9ca3af').font('Helvetica').fontSize(11).text('Agents Progress Report', 42, 72);
  doc.fillColor('#e8e0d0').font('Helvetica').fontSize(10).text('Generated: ' + report.executedAt, 42, 92);
  doc.text('Version: ' + report.version + '  |  All operational: ' + (report.allOperational ? 'Yes' : 'No'), 42, 108);

  doc.moveTo(42, 130).lineTo(553, 130).strokeColor('#4b5563').stroke();
  doc.y = 148;

  writeLine(doc, 'Execution', report.executionMs + 'ms');
  writeLine(doc, 'Next Run', report.nextRun);

  const agents = report.agents || {};
  Object.keys(agents).forEach((key) => {
    const agent = agents[key] || {};
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#c9a84c').text(agent.agent || key.toUpperCase());
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10).fillColor('#e8e0d0').text('Status: ' + (agent.status || 'unknown'));
    doc.text('Timestamp: ' + (agent.timestamp || report.executedAt));

    Object.keys(agent).forEach((field) => {
      if (['agent', 'status', 'timestamp'].includes(field)) return;
      const raw = agent[field];
      const value = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
      writeLine(doc, field, value, { labelSize: 10, valueSize: 9, gap: 0.35 });
      if (doc.y > 720) doc.addPage();
    });
    doc.moveDown(0.4);
    if (doc.y > 720) doc.addPage();
  });

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  process.stdout.write(outPath + '\n');
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});