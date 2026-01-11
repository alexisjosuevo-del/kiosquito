# Kioskito — Configuración Pro (Firebase Auth + Firestore)

## 1) Activar Firebase Auth
Firebase Console → Authentication → Sign-in method → habilita **Email/Password**.

## 2) Crear usuarios
Authentication → Users → Add user:

- **admin@kiosquito.local** (Admin)
- **m01@kiosquito.local**
- **d02@kiosquito.local**
- **a03@kiosquito.local**

> En el login del sistema puedes escribir **admin**, **M01**, **D02**, **A03** (sin @) y el sistema lo convierte a `@kiosquito.local`.

## 3) Activar Firestore
Firebase Console → Firestore Database → Create database.

## 4) Reglas recomendadas (PRO)
Firestore → Rules → pega esto y publica.

> IMPORTANTE: cambia/añade tus correos admin en `ADMIN_EMAILS` dentro de `app_firebase.js` y también aquí, en la lista `admins`.

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function isAdmin() {
      return isSignedIn() && request.auth.token.email in [
        "admin@kiosquito.local"
      ];
    }
    function userDoc(uid) { return get(/databases/$(database)/documents/users/$(uid)); }
    function myRole() {
      return isSignedIn() ? (userDoc(request.auth.uid).data.role) : "none";
    }
    function isSeller() { return isSignedIn() && (myRole() == "seller" || myRole() == "admin"); }

    // Perfil usuario
    match /users/{uid} {
      allow read: if isSignedIn() && (isAdmin() || request.auth.uid == uid);
      // el usuario puede crear su propio perfil, pero NO puede auto-asignarse admin
      allow create: if isSignedIn()
                    && request.auth.uid == uid
                    && request.resource.data.role in ["seller"]
                    && request.resource.data.email == request.auth.token.email;
      // admin puede actualizar roles/perfil
      allow update, delete: if isAdmin();
    }

    // Productos (inventario)
    match /products/{id} {
      allow read: if isSignedIn();
      allow create, update, delete: if isAdmin();
    }

    // Ventas
    match /sales/{id} {
      allow create: if isSeller()
                    && request.resource.data.uid == request.auth.uid;
      allow read: if isAdmin() || (isSignedIn() && resource.data.uid == request.auth.uid);
      allow update, delete: if isAdmin();
    }

    // Caja (turnos)
    match /shifts/{id} {
      allow create: if isSeller() && request.resource.data.uid == request.auth.uid;
      allow read: if isAdmin() || (isSignedIn() && resource.data.uid == request.auth.uid);
      allow update: if isAdmin() || (isSignedIn() && resource.data.uid == request.auth.uid);
      allow delete: if isAdmin();
    }

    // Movimientos inventario (solo admin)
    match /inv_movements/{id} {
      allow read, write: if isAdmin();
    }
  }
}
```

## 5) Nota importante
- En producción, lo ideal es que el admin real sea tu correo (ej: soporte@tudominio.com) y no `@kiosquito.local`.
- Si quieres **usuarios con nombre corto** (M01/D02/A03) sin correo real, esta solución es práctica y funciona.

