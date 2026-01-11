# Kioskito – Inventario & Ventas (Firebase tiempo real)

Esta versión guarda y sincroniza en **tiempo real** usando **Firebase Firestore**.

(Se incluye `app_offline.js` como respaldo offline, pero el `index.html` usa `app_firebase.js`.)

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



## 🔥 Configuración Firebase (Firestore)

Este proyecto usa estas colecciones:
- `products` (catálogo)
- `sales` (ventas)
- `shifts` (cajas)
- `inv_movements` (movimientos de inventario)

### 1) Crear Firestore
Firebase Console → **Firestore Database** → Crear base de datos.

### 2) Reglas (rápido para pruebas)
En **Firestore → Rules**, puedes usar esto **solo para pruebas**:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

⚠️ En producción, NO uses `if true;`. Lo ideal es configurar **Firebase Auth** y reglas por usuario/rol.

### 3) Publicar
- Si usas **GitHub Pages**, solo sube el contenido del proyecto.
- O local: `python -m http.server 8080` y abre `http://localhost:8080`.

