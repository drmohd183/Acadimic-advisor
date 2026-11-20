#!/usr/bin/env python3
"""
استيراد الخطط الدراسية والاسترشادية من ملفات Word (بصيغة موقع الجامعة) إلى JSON
يستخدمه النظام كبيانات أولية (seed) ويمكن للإدارة استيراد JSON الناتج من لوحة الإدارة.

الاستخدام:
  python3 tools/import_docx_plans.py --track SEC --study <study.docx> --guide <guide.docx> --out shared/seed/plan-SEC.json
"""
import argparse, json, re, sys
import docx

CATEGORY_HEADINGS = [
    ("متطلبات استدراكي اجباري", "REMEDIAL"),
    ("متطلب جامعة اجباري", "UNI_REQ"),
    ("متطلب جامعة اختياري", "UNI_ELEC"),
    ("متطلب كلية اجباري", "COL_REQ"),
    ("متطلب كلية اختياري", "COL_ELEC"),
    ("متطلب تخصص اجباري", "MAJ_REQ"),
    ("متطلب تخصص اختياري", "MAJ_ELEC"),
]
YEARS = {"السنة الأولى": 1, "السنة الثانية": 2, "السنة الثالثة": 3, "السنة الرابعة": 4}
TERMS = {"الفصل الأول": 1, "الفصل الثاني": 2, "الفصل الصيفي": 3}
CODE = re.compile(r"^\d{8}$")


def cat_of(text):
    for h, c in CATEGORY_HEADINGS:
        if text.strip().startswith(h):
            return c
    return None


def iter_block_items(document):
    """يعيد الفقرات والجداول بترتيب ظهورها في المستند"""
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    body = document.element.body
    for child in body.iterchildren():
        tag = child.tag.split('}')[-1]
        if tag == 'p':
            yield Paragraph(child, document)
        elif tag == 'tbl':
            yield Table(child, document)


def rows(table):
    out = []
    for r in table.rows:
        cells = [c.text.strip() for c in r.cells]
        # إزالة الخلايا المكررة الناتجة عن الدمج
        dedup = []
        for c in cells:
            if not dedup or dedup[-1] != c:
                dedup.append(c)
        out.append(cells)
    return out


def parse_study(path):
    d = docx.Document(path)
    total = None
    cats = {}
    courses = []
    prereqs = []
    current = None
    for item in iter_block_items(d):
        if item.__class__.__name__ == 'Paragraph':
            t = item.text.strip()
            m = re.search(r"\((\d+)\)\s*ساعة معتمدة", t)
            if m and total is None and 'تتكون' in t or (m and total is None and 'تكون' in t):
                total = int(m.group(1))
            c = cat_of(t)
            if c:
                current = c
                m2 = re.search(r"\((\d+)\)", t)
                cats[c] = int(m2.group(1)) if m2 else None
        else:
            if current is None:
                continue
            for cells in rows(item):
                codes = [x for x in cells if CODE.match(x)]
                if not codes:
                    continue
                code = codes[0]
                idx = cells.index(code)
                name = cells[idx + 1]
                credits = int(cells[idx + 2])
                pre = cells[idx + 3] if idx + 3 < len(cells) else ''
                courses.append({"code": code, "nameAr": name, "credits": credits, "category": current})
                for p in re.findall(r"\d{8}", pre):
                    prereqs.append({"course": code, "requires": p})
    return total, cats, courses, prereqs


def parse_guide(path):
    d = docx.Document(path)
    total = None
    year = term = None
    slots, placed, prereqs = [], [], []
    for item in iter_block_items(d):
        if item.__class__.__name__ == 'Paragraph':
            t = item.text.strip()
            m = re.search(r"\((\d+)\)", t)
            if m and total is None and 'الخطة الاسترشادية من' in t:
                total = int(m.group(1))
            if t in YEARS:
                year = YEARS[t]
            if t in TERMS:
                term = TERMS[t]
        else:
            for cells in rows(item):
                codes = [x for x in cells if CODE.match(x)]
                if codes:
                    code = codes[0]
                    idx = cells.index(code)
                    placed.append({"code": code, "year": year, "term": term, "credits": int(cells[idx + 2])})
                    pre = cells[idx + 3] if idx + 3 < len(cells) else ''
                    for p in re.findall(r"\d{8}", pre):
                        prereqs.append({"course": code, "requires": p})
                    continue
                label = next((x for x in cells if x), '')
                if not label or label.startswith('رقم') or label == 'المجموع':
                    continue
                nums = [x for x in cells if re.fullmatch(r"\d+", x)]
                cr = int(nums[0]) if nums else 0
                c = cat_of(label)
                kind = 'category' if c else 'non_credit'
                slots.append({"year": year, "term": term, "label": label, "credits": cr,
                              "category": c, "kind": kind})
    return total, slots, placed, prereqs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--track', required=True)
    ap.add_argument('--study', required=True)
    ap.add_argument('--guide', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    total, cats, courses, prereqs = parse_study(a.study)
    gtotal, slots, placed, gpre = parse_guide(a.guide)
    issues = []
    byc = {c['code']: c for c in courses}
    for p in placed:
        c = byc.get(p['code'])
        if not c:
            issues.append(f"المساق {p['code']} ورد في الخطة الاسترشادية وليس في الخطة الدراسية")
            continue
        c['suggestedYear'], c['suggestedTerm'] = p['year'], p['term']
        if c['credits'] != p['credits']:
            issues.append(f"اختلاف ساعات {p['code']} بين الخطتين")
    sp = {(x['course'], x['requires']) for x in prereqs}
    gp = {(x['course'], x['requires']) for x in gpre}
    for x in sorted(gp - sp):
        issues.append(f"متطلب سابق {x[1]} للمساق {x[0]} ورد في الاسترشادية فقط")
    for x in sorted(sp - gp):
        if x[0] in {p['code'] for p in placed}:
            issues.append(f"متطلب سابق {x[1]} للمساق {x[0]} ورد في الدراسية فقط")
    out = {"track": a.track, "totalCredits": total, "guideTotalCredits": gtotal,
           "categories": cats, "courses": courses, "prerequisites": prereqs,
           "guidingSlots": slots, "importIssues": issues}
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(a.track, 'courses', len(courses), 'prereqs', len(prereqs), 'slots', len(slots), 'cats', cats, 'issues', issues)


if __name__ == '__main__':
    main()
