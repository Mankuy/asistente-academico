# 📝 Asistente de Escritura Académica

Una app que corrige tus trabajos académicos (tesis, ensayos, monografías) con inteligencia artificial, como lo haría un tutor exigente: te marca errores de citas APA/MLA, redacción y estructura, **te explica por qué** cada cosa está mal, y al final te genera el documento corregido en Word o PDF.

Todo corre **en tu computadora**. Tus textos no se suben a ningún servidor nuestro.

---

## 🚀 Cómo prenderla (2 pasos)

### Paso 1 — Instalá Node.js (solo la primera vez)

Node.js es el motor que hace funcionar la app. Es gratis y seguro:

1. Entrá a **https://nodejs.org**
2. Apretá el botón verde grande (la versión "LTS")
3. Instalalo como cualquier programa: Siguiente, Siguiente, Finalizar

### Paso 2 — Abrí la app

Hacé **doble click en `iniciar_asistente.bat`** (el archivo con el engranaje).

- La primera vez va a tardar un minuto instalando sus piezas — es normal, dejala trabajar.
- Cuando termine, se te abre sola una pestaña del navegador con la app.
- Si no se abre, entrá vos a: **http://localhost:4000**

⚠️ **No cierres la ventana negra** que queda abierta — esa ES la app funcionando. Cuando termines de usarla, la cerrás y listo.

---

## 🔑 Configurar tu llave de IA (solo la primera vez, 3 minutos)

La app necesita conectarse a una inteligencia artificial para corregir. Para eso usás **tu propia llave** (gratis):

1. Entrá a **https://openrouter.ai** y creá una cuenta (con Google es un click)
2. Andá a **Keys** (arriba a la derecha, en tu perfil) → **Create Key** → copiá la llave (empieza con `sk-or-...`)
3. En la app, apretá el **engranaje ⚙️** (arriba a la derecha)
4. Pegá tu llave donde dice OpenRouter
5. En "Modelo", podés dejar el que viene o poner uno **gratuito**, por ejemplo:
   `meta-llama/llama-3.3-70b-instruct:free`
6. Guardá. Listo, no lo tenés que hacer nunca más.

💰 **Sobre el costo:** los modelos que terminan en `:free` son gratis. Si usás un modelo pago, gastás centavos de TU cuenta de OpenRouter — la app te muestra el gasto estimado y **te pide confirmación antes** de cualquier análisis caro. Vos tenés el control.

---

## ✍️ Cómo usarla

### Corregir un texto
1. Pegá tu texto en el editor (o apretá **Subir Documento** para cargar un PDF, Word o TXT)
2. Elegí la **Normativa** (APA, MLA...) y tu **Nivel Académico** (ensayo, tesis de grado, maestría...)
3. Analizá. La IA te devuelve:
   - **Tarjetas con cada error encontrado**: qué está mal, cómo corregirlo y qué norma lo dice
   - Vos **aceptás ✓ o rechazás ✕** cada sugerencia — mandás vos, no la IA
   - Al final, el **texto corregido** aplicando solo lo que aceptaste
4. 💡 Si una tarjeta cita una parte de tu texto, **hacé click en la cita** y te lleva a ese lugar exacto.

### Trabajos largos (tesis completa)
Usá **Modo Tesis**: subís el PDF entero y la app lo procesa por partes, manteniendo el estilo. Detecta sola la carátula y el índice (que ya están bien) y no te los "corrige" — y te muestra el plan y el costo estimado **antes** de empezar, para que confirmes.

### Descargar el resultado
Apretá **⬇️ Generar entregable** y elegí **Word o PDF**. El archivo te queda en la carpeta `entregables` (dentro de la carpeta de la app), con formato académico listo: doble espacio, sangrías y referencias como corresponde.

### ¿Te revisaron un trabajo y tenés que contestar?
Cambiá **"Tipo de documento"** a **"Dictamen de pares recibido"**, pegá la corrección que te hicieron, y la app te ayuda a armar la respuesta punto por punto — y de paso te marca indicios de si el dictamen pudo haber sido escrito con IA (como indicio, no como prueba).

### Cosas que la app NO hace (a propósito)
No te ayuda a "engañar detectores de plagio o de IA" ni nada por el estilo. Si se lo pedís, te va a redirigir a mejorar el texto de verdad. Es una herramienta para **aprender a escribir mejor**, no para hacer trampa.

---

## 🔒 Tu privacidad

- Tus textos y sesiones se guardan **solo en tu computadora** (carpeta `data`).
- Lo único que sale de tu máquina son los fragmentos que se mandan a la IA que VOS elegiste (OpenRouter, etc.) para corregirlos.
- Cero cuentas nuestras, cero tracking, cero nube.

---

## 🆘 Problemas comunes

| Problema | Solución |
|---|---|
| Doble click en el `.bat` y se cierra al instante | Falta Node.js → volvé al Paso 1 |
| "API Key no configurada" | Te falta el Paso de la llave → engranaje ⚙️ |
| El navegador no abre nada | Entrá a mano a `http://localhost:4000` (con la ventana negra abierta) |
| "rechazó la solicitud" o error en rojo | Apretá el botón **🔄 Reintentar** — suele ser un hipo momentáneo de la IA |
| Quiero empezar de cero | Cerrá la ventana negra y volvé a abrir el `.bat` |

---

## 🤓 Para el amigo nerd

- **Docker:** `docker compose up --build` → la app queda en `127.0.0.1:4000`. El compose ya bindea solo a localhost.
- **Config por archivo:** copiá `.env.example` a `.env` — keys por proveedor (`LLM_KEYS_JSON`), modelo económico para el clasificador de intención (`LLM_FAST_MODELS_JSON`), umbral de confirmación de gasto (`COST_CONFIRM_THRESHOLD_USD`).
- **Modo Búnker** (`BUNKER_MODE=true`): bloquea TODA conexión saliente salvo localhost — para usar con Ollama/LM Studio local y que ni un byte salga de la máquina.
- **Proveedores soportados:** 17 (OpenAI, Anthropic, Groq, Gemini, Mistral, Ollama local, etc.) — todos BYOK, se configuran desde el ⚙️.
- Stack: Node + Express + vanilla JS, sin frameworks. El servidor escucha solo en `127.0.0.1`.

---

*Hecho en Montevideo 🇺🇾 — compartilo con quien lo necesite, pero no lo redistribuyas públicamente todavía: está en beta.*
