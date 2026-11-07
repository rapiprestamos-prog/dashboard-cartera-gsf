# Dashboard de Cartera GSF

Dashboard interactivo que lee los reportes del SIF (Grupo de Servicios Financieros) y genera:

- **Resumen 3D**: cartera, PAR30/PAR90, saldo moroso, recaudo, intereses y gastos de manejo.
- **Morosidad**: tramos de días de mora, antigüedad del saldo vencido, mapa de calor producto × tramo, patronos y oficiales, lista de clientes en mora y matriz de transición entre meses.
- **Análisis a fondo**: 25 mayores clientes, curva de concentración, cosechas (saldo y PAR30 por año de desembolso), perfil de vencimientos, tasas, antigüedad del último pago, refinanciados y composición del saldo.
- **Meta de cobros**: meta = cuotas del mes + % de recuperación por tramo (ajustable), cumplimiento, avance diario, meta por oficial y lista de cobro. Descarga su propio Excel (por tramo, oficial, patrono, lista de cobro y quién no pagó).
- **Ingresos**: intereses y GM devengados, FECI, seguro de vida, cancelados y por vencer.
- **Excel GSF**: genera "GSF - Cartera Cierre <fecha>.xlsx" (morosidad al cierre + saldos por rubro) con hojas opcionales de resumen, meta de cobros, 25 mayores clientes y análisis; además un Excel de análisis completo.
- **Presentación gerencial**: en pantalla y descargable en PowerPoint con gráficos editables.
- **Cuadre**: compara cada número del dashboard y cada columna de cada reporte contra los totales del SIF (en septiembre 2026: 172 de 174 exactos; las 2 diferencias son por fecha de impresión).
- **Seguro de vida y FECI**: prima por edad, aseguradora y sexo, préstamos sin seguro, saldo FECI y seguro por tramo, vencidos por antigüedad.
- **Ver reportes**: abre u oculta cada Excel original.

## Datos

El dashboard **no trae datos**. Los Excel se leen en el navegador al cargarlos; no se suben a ningún servidor. Cada reporte se reconoce por el código que trae dentro (`Reporte: pprxxxx`), así que el nombre del archivo no importa. El historial guarda solo totales de cada mes y el tramo por número de contrato (nunca nombres, cédulas ni saldos por cliente): como artifact de Claude, en el almacenamiento privado de la cuenta; fuera de Claude (Vercel, GitHub Pages, archivo local), en el localStorage del navegador. Se puede exportar e importar como .json desde la pestaña Cargar / historial.

Se pueden arrastrar todos los reportes juntos, o la carpeta completa, sobre cualquier parte de la página.

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

## Contraseña e historial en Google Sheets

Fuera de Claude (Vercel, GitHub Pages o archivo local) el dashboard pide contraseña al entrar. La contraseña no está en el código: la valida el Apps Script (`CLAVE` en `apps-script/Code.gs`). Sin la contraseña correcta no se abre el dashboard ni se pueden leer los datos de la hoja.

Instalación (cuenta de Google proyectosrapiprestamos):

1. Crea un Google Sheet nuevo: "Historial dashboard cartera".
2. Extensiones → Apps Script. Pega `apps-script/Code.gs` y cambia `CLAVE` por tu contraseña.
3. Ejecuta la función `instalar` (crea las hojas Meses, Clientes, Modelo y Config) y acepta los permisos.
4. Implementar → Nueva implementación → Aplicación web. Ejecutar como: Yo. Acceso: Cualquier persona. Copia la URL `/exec`.
5. Abre el dashboard, pega la URL y escribe la contraseña. En Cargar / historial elige si se guarda también el detalle por cliente.

Para que el dashboard ya traiga la URL y solo pida la contraseña: `GS_URL="https://script.google.com/macros/s/…/exec" python3 build.py`.

Tamaño: con detalle, cada mes ocupa unos 130 KB comprimidos en la hoja Modelo y 271 filas en Clientes.
