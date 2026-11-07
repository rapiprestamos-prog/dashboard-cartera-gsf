import json,sys
test = len(sys.argv)>1 and sys.argv[1]=='test'
CDN={'echarts':['https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js','https://unpkg.com/echarts@5.5.0/dist/echarts.min.js','https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js'],
 'echartsgl':['https://cdn.jsdelivr.net/npm/echarts-gl@2.0.9/dist/echarts-gl.min.js','https://unpkg.com/echarts-gl@2.0.9/dist/echarts-gl.min.js'],
 'xlsx':['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js','https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js','https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'],
 'exceljs':['https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js','https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js','https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'],
 'pptx':['https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js','https://unpkg.com/pptxgenjs@3.12.0/dist/pptxgen.bundle.js']}
LOC={'echarts':['node_modules/echarts/dist/echarts.min.js'],'echartsgl':['node_modules/echarts-gl/dist/echarts-gl.min.js'],'xlsx':['node_modules/xlsx/dist/xlsx.full.min.js'],'exceljs':['node_modules/exceljs/dist/exceljs.min.js'],'pptx':['nope.js','node_modules/pptxgenjs/dist/pptxgen.bundle.js']}
L=LOC if test else CDN
import os
GS_URL=os.environ.get('GS_URL','')
html=f'''<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Cartera GSF · Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<style>{open('src/app.css').read()}
header.top{{padding-top:env(safe-area-inset-top)}}</style>
</head><body>
{open('src/body.html').read()}
<script>window.__LIBS__={json.dumps(L)};window.__GS_URL__={json.dumps(GS_URL)};window.__APPS_SCRIPT__={json.dumps(open('apps-script/Code.gs').read())};</script>
<script>{open('src/core.js').read()}</script>
<script>{open('src/exporters.js').read()}</script>
<script>{open('src/app.js').read()}</script>
</body></html>'''
out='test.html' if test else 'index.html'
open(out,'w').write(html); print(out,len(html))
