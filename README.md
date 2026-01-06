# Kioskito – Inventario & Ventas (OFFLINE demo)

Esta versión es **solo para ver la interfaz y probar** sin Firebase.
Todo se guarda en tu navegador (localStorage).

## Credenciales demo
- **Usuario:** admin
- **Contraseña:** 1234

## Cómo abrir
Necesitas servirlo con un servidor local (por seguridad del navegador no abre módulos desde file://).

### Opción A) VS Code
- Instala la extensión **Live Server**
- Abre `index.html` con Live Server

### Opción B) Python
```bash
python -m http.server 8080
```
Luego abre:
- http://localhost:8080

## Primeros pasos para probar
1. Inicia sesión (admin / 1234)
2. Ve a **Admin → Cargar productos**
3. Ve a **Productos** y pon precios
4. Ve a **Inventario** y carga stock
5. Ve a **Caja** y abre caja con efectivo inicial
6. Ve a **Punto de venta** y registra ventas
7. Ve a **Reportes** para ver ventas del día / exportar CSV

> Tip: Si quieres borrar todo, en Reportes presiona **Reset demo**.
