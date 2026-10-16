import { REPORT_CHARTS, resolveChartData } from "./report-config.js";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const FALLBACK_COLORS = ["BCDC87", "417FA2", "7E468A", "566B43", "B2B2B2", "635A92", "E5EFD7"];

function escapeXml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function columnName(index) {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cellReference(row, column) { return `${columnName(column)}${row}`; }

function textCell(row, column, value, style = 0) {
  return `<c r="${cellReference(row, column)}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(row, column, value, style = 0, formula = "") {
  const formulaXml = formula ? `<f>${escapeXml(formula)}</f>` : "";
  return `<c r="${cellReference(row, column)}" s="${style}">${formulaXml}<v>${Number(value) || 0}</v></c>`;
}

function rowXml(rowNumber, cells, height = null) {
  return `<row r="${rowNumber}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells.join("")}</row>`;
}

function scalarAnswer(survey, key) {
  const value = survey.answers?.[key]?.value ?? survey.answers?.[key] ?? "";
  return Array.isArray(value) ? value.join("; ") : value;
}

function responsesSheet(template, surveys) {
  const fixedHeaders = ["Survey ID", "Student number", "Review status", "Source PDF"];
  const headers = [...fixedHeaders, ...template.questions.map(question => `${question.key} - ${question.title}`)];
  const rows = [rowXml(1, headers.map((header, index) => textCell(1, index + 1, header, 2)), 30)];
  surveys.forEach((survey, surveyIndex) => {
    const rowNumber = surveyIndex + 2;
    const values = [survey.id, survey.surveyIndex, survey.status, survey.sourceFile, ...template.questions.map(question => scalarAnswer(survey, question.key))];
    rows.push(rowXml(rowNumber, values.map((value, columnIndex) => columnIndex === 1
      ? numberCell(rowNumber, columnIndex + 1, value, 4)
      : textCell(rowNumber, columnIndex + 1, value, 3)), 22));
  });
  const lastColumn = columnName(headers.length);
  const lastRow = Math.max(1, surveys.length + 1);
  const columns = headers.map((header, index) => {
    const width = index < 4 ? [39, 16, 17, 30][index] : Math.min(38, Math.max(13, header.length * 0.7));
    return `<col min="${index + 1}" max="${index + 1}" width="${width.toFixed(1)}" customWidth="1"/>`;
  }).join("");
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${rows.join("")}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

function questionColumn(template, key) {
  const index = template.questions.findIndex(question => question.key === key);
  if (index < 0) throw new Error(`Question ${key} is missing from the survey template.`);
  return columnName(5 + index);
}

function quoteFormula(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function answerRange(template, key, lastResponseRow) {
  const column = questionColumn(template, key);
  return `'Responses'!$${column}$2:$${column}$${Math.max(2, lastResponseRow)}`;
}
function sideField(definition, field, side) { return side ? definition[`${field}${side}`] : definition[field]; }

function countFormula(template, definition, category, side = "", lastResponseRow = 2) {
  // Thematic and multi-select values are derived from reviewed arrays/text in JavaScript.
  // Storing their resolved counts avoids inconsistent array/wildcard recalculation across spreadsheet apps.
  if (definition.id === "learning-themes" || definition.multi) return "";
  const key = sideField(definition, "key", side);
  const range = answerRange(template, key, lastResponseRow);
  const baseIndex = definition.categories.indexOf(category);
  const sourceValues = sideField(definition, "sourceValues", side) || definition.categories;
  const source = baseIndex >= 0 && category !== "Other" ? sourceValues[baseIndex] : "Other";
  const criteria = definition.multi ? `"*${String(source).replaceAll('"', '""')}*"` : quoteFormula(source);
  const clauses = [];
  if (definition.filter) clauses.push(answerRange(template, definition.filter.key, lastResponseRow), quoteFormula(definition.filter.equals));
  if (clauses.length) {
    clauses.push(range, criteria);
    return `COUNTIFS(${clauses.join(",")})`;
  }
  return `COUNTIF(${range},${criteria})`;
}

function buildChartTables(template, surveys) {
  let startRow = 1;
  return REPORT_CHARTS.map(definition => {
    const data = resolveChartData(definition, surveys);
    const headerRow = startRow + 1;
    const firstDataRow = startRow + 2;
    const lastDataRow = firstDataRow + data.categories.length - 1;
    const table = { definition, data, startRow, headerRow, firstDataRow, lastDataRow };
    startRow = lastDataRow + 3;
    return table;
  });
}

function chartDataSheet(template, tables, surveyCount) {
  const rows = [];
  const lastResponseRow = surveyCount + 1;
  for (const table of tables) {
    const { definition, data, startRow, headerRow } = table;
    rows.push(rowXml(startRow, [textCell(startRow, 1, `${definition.number}. ${definition.title}`, 6)], 24));
    rows.push(rowXml(headerRow, [textCell(headerRow, 1, "Response option", 2), textCell(headerRow, 2, definition.kind === "stacked" ? "Before" : "Responses", 2), ...(definition.kind === "stacked" ? [textCell(headerRow, 3, "After", 2)] : [])], 25));
    data.categories.forEach((category, index) => {
      const row = table.firstDataRow + index;
      rows.push(rowXml(row, [
        textCell(row, 1, category, 3),
        numberCell(row, 2, definition.kind === "stacked" ? data.valuesA[index] : data.values[index], 4, countFormula(template, definition, category, definition.kind === "stacked" ? "A" : "", lastResponseRow)),
        ...(definition.kind === "stacked" ? [numberCell(row, 3, data.valuesB[index], 4, countFormula(template, definition, category, "B", lastResponseRow))] : [])
      ], 22));
    });
  }
  const lastRow = tables.at(-1)?.lastDataRow || 1;
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C${lastRow}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="58" customWidth="1"/><col min="2" max="3" width="14" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

function visualReportSheet(surveys, batch) {
  const rows = [rowXml(1, [textCell(1, 1, "U4B Survey Intelligence Results", 1)], 34), rowXml(2, [textCell(2, 1, `${batch.school || "School not specified"} · ${batch.visitDate || "No survey date"} · ${surveys.length} students`, 5)], 22)];
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:T180"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="20" width="11" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData><mergeCells count="2"><mergeCell ref="A1:T1"/><mergeCell ref="A2:T2"/></mergeCells><drawing r:id="rId1"/><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

function stringCache(values) { return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${escapeXml(value)}</c:v></c:pt>`).join("")}</c:strCache>`; }
function numberCache(values) { return `<c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${Number(value) || 0}</c:v></c:pt>`).join("")}</c:numCache>`; }
function chartTitleXml(title) { return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100" b="1"><a:solidFill><a:srgbClr val="3F4D2F"/></a:solidFill></a:rPr><a:t>${escapeXml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>`; }
function reportChartFrame() { return `<c:spPr><a:solidFill><a:srgbClr val="F6F9F1"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`; }

function stackedBarChartXml({ title, categoryRange, categories, series }) {
  const categoryAxisId = 48650112;
  const valueAxisId = 48672768;
  const seriesXml = series.map((item, index) => `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:strRef><c:f>${escapeXml(item.nameRange)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escapeXml(item.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="${item.color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:cat><c:strRef><c:f>${escapeXml(categoryRange)}</c:f>${stringCache(categories)}</c:strRef></c:cat><c:val><c:numRef><c:f>${escapeXml(item.valueRange)}</c:f>${numberCache(item.values)}</c:numRef></c:val></c:ser>`).join("");
  return `${XML_HEADER}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart>${chartTitleXml(title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>${seriesXml}<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:gapWidth val="55"/><c:overlap val="100"/><c:axId val="${categoryAxisId}"/><c:axId val="${valueAxisId}"/></c:barChart><c:catAx><c:axId val="${categoryAxisId}"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:crossAx val="${valueAxisId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="${valueAxisId}"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/><c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${categoryAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>${reportChartFrame()}</c:plotArea><c:legend><c:legendPos val="t"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart>${reportChartFrame()}</c:chartSpace>`;
}

function pieChartXml({ title, categoryRange, categories, valueRange, values, colors }) {
  const points = categories.map((_, index) => `<c:dPt><c:idx val="${index}"/><c:spPr><a:solidFill><a:srgbClr val="${colors[index % colors.length]}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:dPt>`).join("");
  return `${XML_HEADER}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart>${chartTitleXml(title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${points}<c:cat><c:strRef><c:f>${escapeXml(categoryRange)}</c:f>${stringCache(categories)}</c:strRef></c:cat><c:val><c:numRef><c:f>${escapeXml(valueRange)}</c:f>${numberCache(values)}</c:numRef></c:val></c:ser><c:dLbls><c:dLblPos val="bestFit"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showLeaderLines val="1"/><c:separator val="&#10;"/></c:dLbls><c:firstSliceAng val="270"/></c:pieChart>${reportChartFrame()}</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart>${reportChartFrame()}</c:chartSpace>`;
}

function horizontalBarChartXml({ title, categoryRange, categories, valueRange, values, color }) {
  const categoryAxisId = 48650113;
  const valueAxisId = 48672769;
  return `${XML_HEADER}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart>${chartTitleXml(title)}<c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:cat><c:strRef><c:f>${escapeXml(categoryRange)}</c:f>${stringCache(categories)}</c:strRef></c:cat><c:val><c:numRef><c:f>${escapeXml(valueRange)}</c:f>${numberCache(values)}</c:numRef></c:val></c:ser><c:dLbls><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/></c:dLbls><c:gapWidth val="45"/><c:axId val="${categoryAxisId}"/><c:axId val="${valueAxisId}"/></c:barChart><c:catAx><c:axId val="${categoryAxisId}"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="${valueAxisId}"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="${valueAxisId}"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/><c:numFmt formatCode="0" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="${categoryAxisId}"/><c:crosses val="autoZero"/></c:valAx>${reportChartFrame()}</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>${reportChartFrame()}</c:chartSpace>`;
}

function drawingAnchor(chartId, fromColumn, fromRow, toColumn, toRow) {
  return `<xdr:twoCellAnchor><xdr:from><xdr:col>${fromColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${chartId + 1}" name="Chart ${chartId}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${chartId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

function stylesXml() {
  return `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="5"><font><sz val="10"/><color rgb="FF3F4D2F"/><name val="Aptos"/><family val="2"/></font><font><b/><sz val="20"/><color rgb="FF3F4D2F"/><name val="Aptos Display"/><family val="2"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FF3F4D2F"/><name val="Aptos"/><family val="2"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3F4D2F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5EFD7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF6F9F1"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD8E0D1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="1" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
}

function themeXml() {
  return `${XML_HEADER}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="U4B School Visit Theme"><a:themeElements><a:clrScheme name="Visual Report"><a:dk1><a:srgbClr val="3F4D2F"/></a:dk1><a:lt1><a:srgbClr val="F6F9F1"/></a:lt1><a:dk2><a:srgbClr val="566B43"/></a:dk2><a:lt2><a:srgbClr val="E5EFD7"/></a:lt2><a:accent1><a:srgbClr val="BCDC87"/></a:accent1><a:accent2><a:srgbClr val="B2B2B2"/></a:accent2><a:accent3><a:srgbClr val="417FA2"/></a:accent3><a:accent4><a:srgbClr val="7E468A"/></a:accent4><a:accent5><a:srgbClr val="635A92"/></a:accent5><a:accent6><a:srgbClr val="566B43"/></a:accent6><a:hlink><a:srgbClr val="417FA2"/></a:hlink><a:folHlink><a:srgbClr val="7E468A"/></a:folHlink></a:clrScheme><a:fontScheme name="Aptos"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Survey"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function makeCharts(tables) {
  return tables.map(table => {
    const { definition, data, headerRow, firstDataRow, lastDataRow } = table;
    const title = `${definition.number}. ${definition.title}`;
    const palette = (definition.colors || []).map(color => color.replace("#", "").toUpperCase());
    const colors = palette.length ? palette : FALLBACK_COLORS;
    if (definition.kind === "stacked") {
      return stackedBarChartXml({ title, categoryRange: `'Chart Data'!$B$${headerRow}:$C$${headerRow}`, categories: ["Before", "After"], series: data.categories.map((name, index) => ({ name, nameRange: `'Chart Data'!$A$${firstDataRow + index}`, valueRange: `'Chart Data'!$B$${firstDataRow + index}:$C$${firstDataRow + index}`, values: [data.valuesA[index], data.valuesB[index]], color: colors[index % colors.length] })) });
    }
    const args = { title, categoryRange: `'Chart Data'!$A$${firstDataRow}:$A$${lastDataRow}`, categories: data.categories, valueRange: `'Chart Data'!$B$${firstDataRow}:$B$${lastDataRow}`, values: data.values };
    return definition.kind === "bar" ? horizontalBarChartXml({ ...args, color: colors[0] }) : pieChartXml({ ...args, colors });
  });
}

function workbookParts(zip, template, surveys, batch, tables) {
  const charts = makeCharts(tables);
  zip.file("[Content_Types].xml", `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>${charts.map((_, index) => `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.file("_rels/.rels", `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  zip.file("docProps/core.xml", `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>U4B Survey Intelligence Results</dc:title><dc:creator>U4B Survey Intelligence</dc:creator><cp:lastModifiedBy>U4B Survey Intelligence</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>`);
  zip.file("docProps/app.xml", `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>U4B Survey Intelligence</Application><AppVersion>2.0</AppVersion></Properties>`);
  zip.file("xl/workbook.xml", `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="2" xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000"/></bookViews><sheets><sheet name="Responses" sheetId="1" r:id="rId1"/><sheet name="Chart Data" sheetId="2" r:id="rId2"/><sheet name="Visual Report" sheetId="3" r:id="rId3"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`);
  zip.file("xl/styles.xml", stylesXml());
  zip.file("xl/theme/theme1.xml", themeXml());
  zip.file("xl/worksheets/sheet1.xml", responsesSheet(template, surveys));
  zip.file("xl/worksheets/sheet2.xml", chartDataSheet(template, tables, surveys.length));
  zip.file("xl/worksheets/sheet3.xml", visualReportSheet(surveys, batch));
  zip.file("xl/worksheets/_rels/sheet3.xml.rels", `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  const anchors = charts.map((_, index) => { const band = Math.floor(index / 2); const fromColumn = index % 2 === 0 ? 0 : 10; return drawingAnchor(index + 1, fromColumn, 3 + band * 22, fromColumn + 10, 23 + band * 22); }).join("");
  zip.file("xl/drawings/drawing1.xml", `${XML_HEADER}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`);
  zip.file("xl/drawings/_rels/drawing1.xml.rels", `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${charts.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${index + 1}.xml"/>`).join("")}</Relationships>`);
  charts.forEach((chart, index) => zip.file(`xl/charts/chart${index + 1}.xml`, chart));
}

export async function buildSurveyWorkbook({ template, surveys, batch }) {
  if (!globalThis.JSZip) throw new Error("Excel export library did not load.");
  if (!template?.questions || !Array.isArray(surveys)) throw new Error("Survey workbook data is invalid.");
  const tables = buildChartTables(template, surveys);
  const zip = new globalThis.JSZip();
  workbookParts(zip, template, surveys, batch || {}, tables);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export { columnName, escapeXml };
