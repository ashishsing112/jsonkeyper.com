"""Generate the 50,000-order dataset used in blog/json-vs-xml.html as minified
JSON, element-style XML, and attribute-style XML. Seeded, so reruns match.

    python3 gen.py    # writes orders.json, orders.xml, orders-attr.xml here
"""
import json, random
from xml.sax.saxutils import escape
random.seed(42)
N=50000
cities=['London','Paris','Berlin','Madrid','Rome','Oslo','Vienna','Dublin']
recs=[]
for i in range(N):
    recs.append({"orderId":"ord_%07d"%i,"total":round(random.uniform(5,500),2),"paid":random.random()<0.9,
      "customer":{"id":random.randint(1,99999),"city":random.choice(cities)},
      "items":[{"sku":"SKU-%04d"%random.randint(0,9999),"qty":random.randint(1,5)} for _ in range(random.randint(1,3))]})
doc={"orders":recs}
json.dump(doc,open('orders.json','w'),separators=(',',':'))
def x(r):
    items=''.join('<item><sku>%s</sku><qty>%d</qty></item>'%(it['sku'],it['qty']) for it in r['items'])
    return '<order><orderId>%s</orderId><total>%s</total><paid>%s</paid><customer><id>%d</id><city>%s</city></customer><items>%s</items></order>'%(r['orderId'],r['total'],'true' if r['paid'] else 'false',r['customer']['id'],escape(r['customer']['city']),items)
open('orders.xml','w').write('<?xml version="1.0" encoding="UTF-8"?><orders>'+''.join(map(x,recs))+'</orders>')
def xa(r):
    items=''.join('<item sku="%s" qty="%d"/>'%(it['sku'],it['qty']) for it in r['items'])
    return '<order orderId="%s" total="%s" paid="%s"><customer id="%d" city="%s"/>%s</order>'%(r['orderId'],r['total'],'true' if r['paid'] else 'false',r['customer']['id'],r['customer']['city'],items)
open('orders-attr.xml','w').write('<?xml version="1.0" encoding="UTF-8"?><orders>'+''.join(map(xa,recs))+'</orders>')
