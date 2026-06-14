# ============================================================
# Module: Reading Parser (reading_parser.py)
#
# Extracts structured metadata and chapter-by-chapter text
# from EPUB, PDF, and TXT/MD files.
# ============================================================

import os
import re
import zipfile
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

# Try to import pypdf, keep it optional but log error if PDF is uploaded and it's missing
try:
    import pypdf
except ImportError:
    pypdf = None

class MLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.reset()
        self.strict = False
        self.convert_charrefs = True
        self.text = []
        self.ignore_data = False

    def handle_data(self, d):
        if not self.ignore_data:
            self.text.append(d)

    def handle_starttag(self, tag, attrs):
        if tag.lower() in ('style', 'script', 'head', 'title', 'meta', 'link'):
            self.ignore_data = True
        elif tag.lower() in ('p', 'br', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.text.append('\n')

    def handle_endtag(self, tag):
        if tag.lower() in ('style', 'script', 'head', 'title', 'meta', 'link'):
            self.ignore_data = False
        elif tag.lower() in ('p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.text.append('\n')

    def get_data(self):
        return ''.join(self.text)

def strip_tags(html):
    s = MLStripper()
    s.feed(html)
    return s.get_data()

def clean_whitespace(text):
    # Standardize newlines and remove excessive spaces
    text = re.sub(r'\r\n', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def parse_txt(file_path, original_filename=None):
    """Parse a plain text or markdown file, splitting into chapters if headers exist."""
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    # Look for common chapter patterns:
    # "Chapter 1", "CHAPTER I", "第十一回", "第一章", "第1章", etc.
    pattern = re.compile(
        r'^(?:Chapter\s+\d+|CHAPTER\s+[IVXLCDM]+|第\s*[0-9一二三四五六七八九十百千]+[章节回分折]|[#]{1,3}\s+.*)$',
        re.MULTILINE | re.IGNORECASE
    )

    matches = list(pattern.finditer(content))
    filename = original_filename or os.path.basename(file_path)
    title = os.path.splitext(filename)[0]

    chapters = []
    if not matches:
        # No chapters found, split by size (roughly 5000 chars per chapter)
        chunk_size = 8000
        total_len = len(content)
        if total_len <= chunk_size:
            chapters.append({
                "title": "Full Text",
                "content": clean_whitespace(content)
            })
        else:
            chunks = [content[i:i+chunk_size] for i in range(0, total_len, chunk_size)]
            for idx, chunk in enumerate(chunks):
                chapters.append({
                    "title": f"Section {idx + 1}",
                    "content": clean_whitespace(chunk)
                })
    else:
        # Split by matches
        for i in range(len(matches)):
            start = matches[i].start()
            end = matches[i+1].start() if i + 1 < len(matches) else len(content)
            
            # The title is the matched line
            chapter_title = content[matches[i].start():matches[i].end()].strip()
            chapter_content = content[matches[i].end():end].strip()
            
            chapters.append({
                "title": chapter_title,
                "content": clean_whitespace(chapter_content)
            })

    return {
        "title": title,
        "author": "Unknown Author",
        "chapters": chapters
    }

def parse_epub(file_path):
    """Parse an EPUB file into structured chapters using standard zipfile and xml parsing."""
    if not zipfile.is_zipfile(file_path):
        raise ValueError("Invalid EPUB file (not a zip archive).")

    with zipfile.ZipFile(file_path) as epub:
        # 1. Find the container file to locate OPF
        container_xml = epub.read('META-INF/container.xml')
        root = ET.fromstring(container_xml)
        ns = {'ns': 'urn:oasis:names:tc:opendocument:xmlns:container'}
        rootfile = root.find('.//ns:rootfile', ns)
        if rootfile is None:
            raise ValueError("Invalid container.xml structure.")
        
        opf_path = rootfile.attrib['full-path']
        opf_dir = os.path.dirname(opf_path)

        # 2. Parse OPF file
        opf_xml = epub.read(opf_path)
        opf_root = ET.fromstring(opf_xml)
        
        # XML Namespaces
        ns_opf = {
            'opf': 'http://www.idpf.org/2007/opf',
            'dc': 'http://purl.org/dc/elements/1.1/'
        }

        # Extract title and author
        title_el = opf_root.find('.//dc:title', ns_opf)
        author_el = opf_root.find('.//dc:creator', ns_opf)
        
        title = title_el.text if title_el is not None else "Unknown Title"
        author = author_el.text if author_el is not None else "Unknown Author"

        # Manifest maps id to href
        manifest = {}
        for item in opf_root.findall('.//opf:manifest/opf:item', ns_opf):
            manifest[item.attrib['id']] = item.attrib['href']

        # Spine lists reading order
        spine = []
        for itemref in opf_root.findall('.//opf:spine/opf:itemref', ns_opf):
            spine.append(itemref.attrib['idref'])

        # 3. Read and strip HTML from chapters in spine order
        chapters = []
        chapter_idx = 1
        for idref in spine:
            href = manifest.get(idref)
            if not href:
                continue
            
            # Resolve relative path
            full_href = os.path.join(opf_dir, href) if opf_dir else href
            # Standardize path slashes for zipfile
            full_href = full_href.replace('\\', '/')
            
            try:
                html_bytes = epub.read(full_href)
                html_str = html_bytes.decode('utf-8', errors='ignore')
                
                # Strip tags and clean text
                raw_text = strip_tags(html_str)
                clean_text = clean_whitespace(raw_text)
                
                if not clean_text:
                    continue # Skip empty items (e.g. stylesheets, images, covers)

                # Try to find a header as chapter title, or default
                header_match = re.search(r'<h[1-3][^>]*>(.*?)</h[1-3]>', html_str, re.IGNORECASE | re.DOTALL)
                if header_match:
                    chapter_title = strip_tags(header_match.group(1)).strip()
                else:
                    chapter_title = f"Chapter {chapter_idx}"
                    chapter_idx += 1
                
                # Truncate title if too long
                if len(chapter_title) > 80:
                    chapter_title = chapter_title[:77] + "..."

                chapters.append({
                    "title": chapter_title,
                    "content": clean_text
                })
            except Exception as e:
                # Log error and skip item
                print(f"Error reading EPUB spine item {idref}: {e}")
                continue

        # 4. Extract cover image if present
        cover_bytes = None
        cover_ext = None
        try:
            cover_href = None
            # EPUB 3 style
            for item in opf_root.findall('.//opf:manifest/opf:item', ns_opf):
                properties = item.attrib.get('properties', '')
                if 'cover-image' in properties:
                    cover_href = item.attrib.get('href')
                    break
            
            # EPUB 2 style
            if not cover_href:
                meta_cover = None
                for meta in opf_root.findall('.//opf:metadata/opf:meta', ns_opf):
                    if meta.attrib.get('name') == 'cover':
                        meta_cover = meta.attrib.get('content')
                        break
                if meta_cover:
                    for item in opf_root.findall('.//opf:manifest/opf:item', ns_opf):
                        if item.attrib.get('id') == meta_cover:
                            cover_href = item.attrib.get('href')
                            break
            
            # Fallback: check item id or href for "cover" keyword
            if not cover_href:
                for item in opf_root.findall('.//opf:manifest/opf:item', ns_opf):
                    item_id = item.attrib.get('id', '').lower()
                    href = item.attrib.get('href', '').lower()
                    media_type = item.attrib.get('media-type', '').lower()
                    if ('cover' in item_id or 'cover' in href) and media_type.startswith('image/'):
                        cover_href = item.attrib.get('href')
                        break
            
            if cover_href:
                full_cover_href = os.path.join(opf_dir, cover_href) if opf_dir else cover_href
                full_cover_href = full_cover_href.replace('\\', '/')
                cover_bytes = epub.read(full_cover_href)
                cover_ext = os.path.splitext(cover_href)[1].lower() or '.jpg'
        except Exception as ce:
            print(f"Error extracting EPUB cover image: {ce}")

    return {
        "title": title,
        "author": author,
        "chapters": chapters,
        "cover_bytes": cover_bytes,
        "cover_ext": cover_ext
    }

def parse_pdf(file_path, original_filename=None):
    """Parse a PDF file into structured pages/sections."""
    if not pypdf:
        raise ImportError("pypdf library is required for PDF parsing but is not installed.")

    reader = pypdf.PdfReader(file_path)
    filename = original_filename or os.path.basename(file_path)
    title = os.path.splitext(filename)[0]
    
    # Try to get document metadata
    meta = reader.metadata
    author = "Unknown Author"
    if meta:
        if meta.title:
            title = meta.title
        if meta.author:
            author = meta.author

    # PDF doesn't have native "chapters" without parsing outlines.
    # We will try to parse outline (bookmarks).
    outline = reader.outline
    
    chapters = []
    
    # If no outline or parsing outline fails, group every 5 pages as a "section"
    # to make it readable in the UI without browser lag.
    pages_per_section = 5
    num_pages = len(reader.pages)
    
    section_idx = 1
    for i in range(0, num_pages, pages_per_section):
        end_page = min(i + pages_per_section, num_pages)
        section_text = []
        for p_idx in range(i, end_page):
            page = reader.pages[p_idx]
            text = page.extract_text()
            if text:
                section_text.append(text)
        
        combined_text = "\n\n".join(section_text)
        clean_text = clean_whitespace(combined_text)
        
        if clean_text:
            chapters.append({
                "title": f"Pages {i + 1} - {end_page}",
                "content": clean_text
            })
            section_idx += 1

    return {
        "title": title,
        "author": author,
        "chapters": chapters
    }

def parse_book(file_path, original_filename=None):
    """Dispatch file to corresponding parser based on extension."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == '.epub':
        return parse_epub(file_path)
    elif ext == '.pdf':
        return parse_pdf(file_path, original_filename)
    elif ext in ('.txt', '.md'):
        return parse_txt(file_path, original_filename)
    else:
        raise ValueError(f"Unsupported file format: {ext}")
