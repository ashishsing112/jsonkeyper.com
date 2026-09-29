"""Parse one file and report wall time and peak RSS. Run each case in a fresh
process so peaks do not contaminate each other; the article reports the median
of five runs.

    python3 parse.py json orders.json
    python3 parse.py xml orders.xml
    python3 parse.py xml orders-attr.xml
    python3 parse.py xml2dict orders.xml
"""
import sys, time, resource, json
import xml.etree.ElementTree as ET
kind, path = sys.argv[1], sys.argv[2]
data = open(path, 'rb').read()
base = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
t = time.perf_counter()
if kind == 'json':
    doc = json.loads(data)
    n = len(doc['orders'])
elif kind == 'xml':
    doc = ET.fromstring(data)
    n = len(doc)
elif kind == 'xml2dict':
    # parse and convert to the same Python structure json.loads returns
    root = ET.fromstring(data)
    out = []
    for o in root:
        c = o.find('customer')
        out.append({'orderId': o.findtext('orderId'), 'total': float(o.findtext('total')), 'paid': o.findtext('paid') == 'true',
                    'customer': {'id': int(c.findtext('id')), 'city': c.findtext('city')},
                    'items': [{'sku': i.findtext('sku'), 'qty': int(i.findtext('qty'))} for i in o.find('items')]})
    n = len(out)
dt = time.perf_counter() - t
peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
print(f'{kind:9s} {path:16s} n={n} time={dt*1000:.0f}ms peak_rss={peak/1024:.0f}MB delta={(peak-base)/1024:.0f}MB')
