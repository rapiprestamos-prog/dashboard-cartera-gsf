# Dashboard de Cartera GSF

Dashboard interactivo que lee los reportes del SIF (Grupo de Servicios Financieros) y genera:

- **Resumen 3D**: cartera, PAR30/PAR90, saldo moroso, recaudo, intereses y gastos de manejo.
- **Morosidad**: tramos de días de mora, antigüedad del saldo vencido, mapa de calor producto × tramo, patronos y oficiales, lista de clientes en mora y matriz de transición entre meses.
- **Meta de cobros**: meta = cuotas del mes + % de recuperación por tramo (ajustable), cumplimiento, avance diario, meta por oficial y lista de cobro.
- **Ingresos**: intereses y GM devengados, FECI, seguro de vida, cancelados y por vencer.
- **Excel GSF**: genera "GSF - Cartera Cierre <fecha>.xlsx" (morosidad al cierre + saldos por rubro) y un Excel de análisis.
- **Presentación gerencial**: en pantalla y descargable en PowerPoint con gráficos editables.
- **Ver reportes**: abre u oculta cada Excel original.

## Datos

El dashboard **no trae datos**. Los Excel se leen en el navegador al cargarlos; no se suben a ningún servidor. Cada reporte se reconoce por el código que trae dentro (`Reporte: pprxxxx`), así que el nombre del archivo no importa. Cuando corre como artifact de Claude, solo se guardan los totales de cada mes en el historial privado del usuario; fuera de Claude se guardan en el navegador (localStorage).

## Uso

Abre `index.html` en el navegador y pulsa **Cargar mes**. Selecciona todos los reportes del cierre a la vez.

## Desarrollo

El código fuente está en `src/`:

| Archivo | Qué hace |
| --- | --- |
| `src/core.js` | Lectura de reportes, modelo mensual, indicadores, meta de cobros y filas del Excel GSF |
| `src/exporters.js` | Excel GSF y Excel de análisis (ExcelJS) |
| `src/app.js` | Interfaz, gráficos (ECharts / ECharts GL), presentación (PptxGenJS) |
| `src/app.css`, `src/body.html` | Estilos y estructura |

Para regenerar `index.html` después de editar `src/`:

```
python3 build.py
```

Librerías (CDN): SheetJS, ExcelJS, ECharts, ECharts GL, PptxGenJS.
