/// Extract text from a PDF file, returning text with [Page N] markers.
pub fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    let text = pdf_extract::extract_text_from_mem(bytes).map_err(|e| e.to_string())?;

    // pdf-extract returns all text concatenated. We split by form feeds if present,
    // otherwise return as a single page.
    let pages: Vec<&str> = if text.contains('\u{0C}') {
        text.split('\u{0C}').collect()
    } else {
        vec![&text]
    };

    let mut result = String::new();
    for (i, page) in pages.iter().enumerate() {
        let trimmed = page.trim();
        if !trimmed.is_empty() {
            result.push_str(&format!("[Page {}]\n{}\n\n", i + 1, trimmed));
        }
    }

    Ok(result)
}

/// Extract text from a DOCX file by reading word/document.xml from the ZIP.
pub fn extract_docx_text(bytes: &[u8]) -> Result<String, String> {
    use std::io::{Cursor, Read};

    let reader = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;

    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|e| e.to_string())?
        .read_to_string(&mut xml)
        .map_err(|e| e.to_string())?;

    // Simple XML text extraction: pull text between <w:t> tags
    let mut result = String::new();
    let mut in_paragraph = false;

    for part in xml.split('<') {
        if part.starts_with("w:p ") || part.starts_with("w:p>") {
            if in_paragraph && !result.ends_with('\n') {
                result.push('\n');
            }
            in_paragraph = true;
        }
        if part.starts_with("w:t>") || part.starts_with("w:t ") {
            if let Some(text) = part.split('>').nth(1) {
                result.push_str(text);
            }
        }
        if part.starts_with("/w:t>") {
            // text node closed, content already captured
        }
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// DOCX → styled HTML
//
// A streaming quick-xml pass over word/document.xml that emits semantic HTML:
//   - <w:p> with style starting with "Heading" → <h1>..<h6>
//   - <w:r>/<w:t> runs accumulate into the parent <p> / <h*>
//   - <w:rPr><w:b/>, <w:i/>, <w:u/> → <strong>, <em>, <u>
//   - <w:tbl> → <table>, <w:tr> → <tr>, <w:tc> → <td>
//   - <w:ins> / <w:del> map to inline markers so a later phase can add
//     tracked-change visualization
// ---------------------------------------------------------------------------

use quick_xml::events::Event;
use quick_xml::reader::Reader;

/// Render document.xml content as minimal semantic HTML. Returns a string
/// containing `<p>`, `<h1..6>`, `<table>`, `<tr>`, `<td>` elements with
/// `<strong>`, `<em>`, `<u>` inline runs. HTML-escapes all text content.
pub fn extract_docx_html(bytes: &[u8]) -> Result<String, String> {
    use std::io::{Cursor, Read};

    let reader = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|e| e.to_string())?
        .read_to_string(&mut xml)
        .map_err(|e| e.to_string())?;

    render_document_xml(&xml)
}

#[derive(Default, Clone, Copy)]
struct RunFormat {
    bold: bool,
    italic: bool,
    underline: bool,
}

fn render_document_xml(xml: &str) -> Result<String, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut out = String::new();
    // Parser state
    let mut in_body = false;
    let mut in_para = false;
    let mut para_buf = String::new();
    let mut para_is_empty = true;
    let mut in_run = false;
    let mut in_text = false;
    let mut rpr_active = false;
    let mut current_fmt = RunFormat::default();
    let mut in_ins = false;
    let mut in_del = false;
    // Table state
    let mut table_depth = 0; // 0 means not in table

    // Pending paragraph style captured from <w:pStyle w:val="..."/>
    let mut pending_pstyle: Option<String> = None;

    loop {
        match reader.read_event() {
            Err(e) => return Err(format!("xml error at pos {}: {}", reader.buffer_position(), e)),
            Ok(Event::Eof) => break,

            Ok(Event::Start(e)) => {
                let name = std::str::from_utf8(e.name().as_ref()).unwrap_or("").to_string();
                match name.as_str() {
                    "w:body" => in_body = true,

                    "w:tbl" => {
                        if !in_body {
                            continue;
                        }
                        table_depth += 1;
                        out.push_str("<table class=\"docx-table\">");
                    }
                    "w:tr" => {
                        if table_depth > 0 {
                            out.push_str("<tr>");
                        }
                    }
                    "w:tc" => {
                        if table_depth > 0 {
                            out.push_str("<td>");
                        }
                    }

                    "w:p" => {
                        if !in_body {
                            continue;
                        }
                        in_para = true;
                        para_buf.clear();
                        para_is_empty = true;
                        pending_pstyle = None;
                    }

                    "w:pStyle" => {
                        // Capture w:val attribute to decide heading level.
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"w:val" {
                                if let Ok(val) = std::str::from_utf8(&attr.value) {
                                    pending_pstyle = Some(val.to_string());
                                }
                            }
                        }
                    }

                    "w:r" => {
                        in_run = true;
                        current_fmt = RunFormat::default();
                    }

                    "w:rPr" => {
                        rpr_active = true;
                    }

                    "w:t" => {
                        in_text = true;
                    }

                    "w:ins" => {
                        in_ins = true;
                        para_buf.push_str("<ins class=\"docx-ins\">");
                    }
                    "w:del" => {
                        in_del = true;
                        para_buf.push_str("<del class=\"docx-del\">");
                    }

                    _ => {}
                }
            }

            Ok(Event::Empty(e)) => {
                let name = std::str::from_utf8(e.name().as_ref()).unwrap_or("").to_string();
                match name.as_str() {
                    // Formatting flags. <w:b/>, <w:i/>, <w:u .../> appear
                    // as empty tags inside <w:rPr>. A `w:val="0"` or
                    // `w:val="false"` disables the toggle (Word-speak).
                    "w:b" | "w:i" | "w:u" => {
                        if rpr_active {
                            let disabled = e.attributes().flatten().any(|a| {
                                a.key.as_ref() == b"w:val"
                                    && matches!(a.value.as_ref(), b"0" | b"false")
                            });
                            let enable = !disabled;
                            match name.as_str() {
                                "w:b" => current_fmt.bold = enable,
                                "w:i" => current_fmt.italic = enable,
                                "w:u" => current_fmt.underline = enable,
                                _ => {}
                            }
                        }
                    }

                    "w:pStyle" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"w:val" {
                                if let Ok(val) = std::str::from_utf8(&attr.value) {
                                    pending_pstyle = Some(val.to_string());
                                }
                            }
                        }
                    }

                    "w:br" => {
                        if in_para {
                            para_buf.push_str("<br/>");
                        }
                    }

                    "w:tab" => {
                        if in_para {
                            para_buf.push_str("&nbsp;&nbsp;&nbsp;&nbsp;");
                        }
                    }

                    _ => {}
                }
            }

            Ok(Event::Text(t)) => {
                if in_text && in_para {
                    let raw = t.unescape().map_err(|e| e.to_string())?.into_owned();
                    if !raw.is_empty() {
                        para_is_empty = false;
                        let mut open_tags = String::new();
                        let mut close_tags = String::new();
                        if current_fmt.bold {
                            open_tags.push_str("<strong>");
                            close_tags.insert_str(0, "</strong>");
                        }
                        if current_fmt.italic {
                            open_tags.push_str("<em>");
                            close_tags.insert_str(0, "</em>");
                        }
                        if current_fmt.underline {
                            open_tags.push_str("<u>");
                            close_tags.insert_str(0, "</u>");
                        }
                        para_buf.push_str(&open_tags);
                        para_buf.push_str(&html_escape(&raw));
                        para_buf.push_str(&close_tags);
                    }
                }
            }

            Ok(Event::End(e)) => {
                let name = std::str::from_utf8(e.name().as_ref()).unwrap_or("").to_string();
                match name.as_str() {
                    "w:body" => in_body = false,

                    "w:tbl" => {
                        if table_depth > 0 {
                            table_depth -= 1;
                            out.push_str("</table>");
                        }
                    }
                    "w:tr" => {
                        if table_depth > 0 {
                            out.push_str("</tr>");
                        }
                    }
                    "w:tc" => {
                        if table_depth > 0 {
                            out.push_str("</td>");
                        }
                    }

                    "w:p" => {
                        if in_para {
                            // Commit paragraph. Choose tag from captured style.
                            let tag = match pending_pstyle.as_deref() {
                                Some(s) if s.starts_with("Heading1") || s == "Title" => "h1",
                                Some(s) if s.starts_with("Heading2") => "h2",
                                Some(s) if s.starts_with("Heading3") => "h3",
                                Some(s) if s.starts_with("Heading") => "h4",
                                _ => "p",
                            };
                            // Empty paragraphs become <p>&nbsp;</p> to keep
                            // spacing rhythm the user would see in Word.
                            out.push('<');
                            out.push_str(tag);
                            out.push('>');
                            if para_is_empty {
                                out.push_str("&nbsp;");
                            } else {
                                out.push_str(&para_buf);
                            }
                            out.push_str("</");
                            out.push_str(tag);
                            out.push('>');

                            in_para = false;
                            para_buf.clear();
                            para_is_empty = true;
                            pending_pstyle = None;
                        }
                    }

                    "w:r" => {
                        in_run = false;
                        current_fmt = RunFormat::default();
                    }
                    "w:rPr" => {
                        rpr_active = false;
                    }
                    "w:t" => {
                        in_text = false;
                    }
                    "w:ins" => {
                        if in_ins {
                            para_buf.push_str("</ins>");
                            in_ins = false;
                        }
                    }
                    "w:del" => {
                        if in_del {
                            para_buf.push_str("</del>");
                            in_del = false;
                        }
                    }

                    _ => {}
                }
            }

            _ => {}
        }
    }

    let _ = in_run;
    let _ = in_ins;
    let _ = in_del;
    Ok(out)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_pdf_text_invalid_bytes() {
        let result = extract_pdf_text(b"not a pdf");
        assert!(result.is_err());
    }

    #[test]
    fn extract_docx_text_invalid_bytes() {
        let result = extract_docx_text(b"not a docx");
        assert!(result.is_err());
    }

    #[test]
    fn extract_docx_text_valid_zip_no_document_xml() {
        // Create a minimal ZIP without word/document.xml
        let buf = Vec::new();
        let cursor = std::io::Cursor::new(buf);
        let mut zip = zip::ZipWriter::new(cursor);
        zip.start_file("test.txt", zip::write::SimpleFileOptions::default()).unwrap();
        use std::io::Write;
        zip.write_all(b"hello").unwrap();
        let cursor = zip.finish().unwrap();
        let bytes = cursor.into_inner();

        let result = extract_docx_text(&bytes);
        assert!(result.is_err()); // No word/document.xml
    }

    #[test]
    fn extract_docx_text_minimal_document() {
        let buf = Vec::new();
        let cursor = std::io::Cursor::new(buf);
        let mut zip = zip::ZipWriter::new(cursor);
        zip.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        use std::io::Write;
        zip.write_all(br#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello World</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>
  </w:body>
</w:document>"#).unwrap();
        let cursor = zip.finish().unwrap();
        let bytes = cursor.into_inner();

        let result = extract_docx_text(&bytes).unwrap();
        assert!(result.contains("Hello World"));
        assert!(result.contains("Second paragraph"));
    }

    #[test]
    fn render_docx_html_headings_and_runs() {
        let xml = r#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t> and </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r></w:p>
  </w:body>
</w:document>"#;
        let html = render_document_xml(xml).unwrap();
        assert!(html.contains("<h1>Title</h1>"));
        assert!(html.contains("<strong>Bold</strong>"));
        assert!(html.contains("<em>italic</em>"));
    }

    #[test]
    fn render_docx_html_escapes_content() {
        let xml = r#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>a &amp; b &lt; c</w:t></w:r></w:p>
  </w:body>
</w:document>"#;
        let html = render_document_xml(xml).unwrap();
        // Must preserve escaping — otherwise we risk XSS when injected.
        assert!(html.contains("a &amp; b &lt; c"));
        assert!(!html.contains("a & b < c"));
    }

    #[test]
    fn render_docx_html_table() {
        let xml = r#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>"#;
        let html = render_document_xml(xml).unwrap();
        assert!(html.contains("<table"));
        assert!(html.contains("<tr>"));
        assert!(html.contains("<td>"));
        assert!(html.contains("A1"));
        assert!(html.contains("B1"));
    }
}
