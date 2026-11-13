const headers = [
  ['order_id', 'Order ID'], ['order_date', 'Order Date'], ['customer_name', 'Customer'],
  ['product_name', 'Product'], ['category_name', 'Category'], ['quantity', 'Quantity'],
  ['line_amount', 'Line Amount'], ['order_total', 'Order Total'],
  ['sale_status', 'Sale Status'], ['payment_method', 'Payment Method'], ['order_status', 'Order Status'],
]

function csvEscape(value) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function xmlEscape(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function createCsv(rows) {
  const data = [headers.map(([, label]) => csvEscape(label)).join(',')]
  rows.forEach(row => data.push(headers.map(([key]) => csvEscape(row[key])).join(',')))
  return new Blob(['\ufeff', data.join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

function createJson(rows) {
  return new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8' })
}

const encoder = new TextEncoder()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zipStore(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const [filename, content] of files) {
    const name = encoder.encode(filename)
    const data = encoder.encode(content)
    const checksum = crc32(data)
    const local = new Uint8Array(30 + name.length + data.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    localParts.push(local)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centralParts.push(central)
    offset += local.length
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  return new Blob([...localParts, ...centralParts, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function createExcel(rows) {
  const allRows = [headers.map(([, label]) => label), ...rows.map(row => headers.map(([key]) => row[key] ?? ''))]
  const sheetRows = allRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const reference = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`
    return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
  }).join('')}</row>`).join('')
  return zipStore([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales Report" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`],
  ])
}

function pdfText(value) {
  return String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '?').replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function createPdf(rows) {
  const lines = [
    'SCHOOLSUPPLY - SALES REPORT',
    `Generated ${new Date().toLocaleString('en-PH')}`,
    `${rows.length} matching report line items`,
    '',
    headers.map(([, label]) => label).join(' | '),
    '-'.repeat(110),
    ...rows.map(row => headers.map(([key]) => String(row[key] ?? '—').replaceAll('|', '/')).join(' | ')),
  ]
  const chunks = []
  for (let index = 0; index < lines.length; index += 43) chunks.push(lines.slice(index, index + 43))
  if (!chunks.length) chunks.push([])
  const objects = new Map()
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>')
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageIds = chunks.map((_, index) => 5 + index * 2)
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  chunks.forEach((pageLines, index) => {
    const contentId = 4 + index * 2
    const pageId = contentId + 1
    const content = `BT /F1 8 Tf 36 756 Td 10 TL ${pageLines.map(line => `(${pdfText(line)}) Tj T*`).join(' ')} ET`
    objects.set(contentId, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`)
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`)
  })
  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (let id = 1; id <= objects.size + 2; id += 1) {
    if (!objects.has(id)) continue
    offsets[id] = encoder.encode(document).length
    document += `${id} 0 obj\n${objects.get(id)}\nendobj\n`
  }
  const xrefOffset = encoder.encode(document).length
  const objectCount = Math.max(...objects.keys()) + 1
  document += `xref\n0 ${objectCount}\n0000000000 65535 f \n`
  for (let id = 1; id < objectCount; id += 1) document += `${String(offsets[id] || 0).padStart(10, '0')} 00000 n \n`
  document += `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return new Blob([document], { type: 'application/pdf' })
}

export function downloadAnalyticsReport(format, rows) {
  const normalized = format.toLowerCase()
  const exporters = {
    pdf: [createPdf, 'pdf'],
    excel: [createExcel, 'xlsx'],
    csv: [createCsv, 'csv'],
    json: [createJson, 'json'],
  }
  const exporter = exporters[normalized]
  if (!exporter) throw new Error(`Unsupported report export format: ${format}`)
  download(exporter[0](rows), `school-supply-sales-report.${exporter[1]}`)
}
