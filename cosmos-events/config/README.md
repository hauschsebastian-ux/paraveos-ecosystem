# Fragebogen-Konfiguration

Der interaktive Fragebogen ist datengetrieben. Der finale Fragebogen von Cosmos Events
wird als `questionnaire.json` in diesem Ordner abgelegt (oder per `QUESTIONNAIRE_FILE`
referenziert) – ohne Codeänderung. Fehlt die Datei, gilt der eingebaute Standard-Fragebogen
(`src/questionnaire.js`, `DEFAULT_SCHEMA`).

## Format

```json
{
  "version": 2,
  "title": "Eventplanung",
  "sections": [
    {
      "id": "basics",
      "title": "Eckdaten",
      "icon": "📋",
      "description": "Kurzer Hinweistext zum Abschnitt",
      "fields": [
        { "id": "couple_names", "label": "Namen des Brautpaars", "type": "text", "required": true },
        { "id": "guest_count", "label": "Gästezahl", "type": "number", "required": true, "min": 1, "max": 5000 },
        { "id": "style", "label": "Stil", "type": "select", "options": ["Elegant", "Boho"], "required": false },
        { "id": "first_dance", "label": "Eröffnungstanz?", "type": "radio", "options": ["Ja", "Nein"], "required": true },
        { "id": "dance_style", "label": "Tanzstil", "type": "text", "showIf": { "field": "first_dance", "equals": "Ja" } },
        { "id": "genres", "label": "Genres", "type": "multiselect", "options": ["Pop", "House"] },
        { "id": "dinner_time", "label": "Beginn Essen", "type": "time", "required": true },
        { "id": "notes", "label": "Sonstiges", "type": "textarea", "help": "Optionaler Hilfetext" },
        { "id": "consent", "label": "Einwilligungstext …", "type": "boolean", "required": true }
      ]
    }
  ]
}
```

Feldtypen: `text`, `textarea`, `number`, `date`, `time`, `select`, `radio`, `multiselect`, `boolean`.

- `required` steuert den Fortschritt (beantwortete Pflichtfelder / sichtbare Pflichtfelder).
- `showIf` blendet ein Feld nur ein, wenn ein anderes Feld einen bestimmten Wert hat.
- Feld-IDs sollten stabil bleiben, damit bereits gespeicherte Antworten erhalten bleiben.
- Nach einer Änderung den Server neu starten (das Schema wird beim Start geladen).
