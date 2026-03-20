// ============================================================
// PIX Field Agent — Agente IA para PIX Muestreo (campo)
// GPS guidance, collection help, voice, error monitoring
// ============================================================

class PixFieldAgent {
  constructor() {
    this.name = 'PIX Campo';
    this.version = '1.0.0';
    this.isOpen = false;
    this.isListening = false;
    this.isSpeaking = false;
    this.messages = [];
    this.errorLog = [];
    this.recognition = null;
    this.synthesis = window.speechSynthesis || null;
    this.voiceEnabled = true;

    // GPS guidance state
    this.targetPoint = null;
    this.guidanceActive = false;
    this.guidanceInterval = null;
  }

  // ===== INITIALIZATION =====

  init() {
    this._buildChatUI();
    this._setupErrorMonitor();
    this._setupSpeechRecognition();
    this._addSystemMessage('PIX Campo activo. Te guío en la colecta de muestras. ¿Necesitás ayuda?');
    console.log('[PIX Campo] Field agent initialized');
  }

  // ===== CHAT UI (Mobile optimized) =====

  _buildChatUI() {
    const fab = document.createElement('div');
    fab.id = 'fieldAgentFab';
    fab.className = 'field-agent-fab';
    fab.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="26" height="26">
        <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z"/>
        <path d="M9 21h6"/>
      </svg>
      <span class="field-agent-badge" id="fieldAgentBadge" style="display:none">0</span>
    `;
    fab.onclick = () => this.toggle();

    const panel = document.createElement('div');
    panel.id = 'fieldAgentPanel';
    panel.className = 'field-agent-panel';
    panel.innerHTML = `
      <div class="field-agent-header">
        <div class="field-agent-header-left">
          <div class="field-agent-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z"/>
            </svg>
          </div>
          <div>
            <div class="field-agent-name">PIX Campo</div>
            <div class="field-agent-status"><span class="field-agent-dot"></span>Asistente de campo</div>
          </div>
        </div>
        <button class="field-agent-close" onclick="fieldAgent.toggle()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="field-agent-messages" id="fieldAgentMessages"></div>
      <div class="field-agent-quick" id="fieldAgentQuick">
        <button class="field-quick-btn" onclick="fieldAgent.handleCommand('/gps')">GPS</button>
        <button class="field-quick-btn" onclick="fieldAgent.handleCommand('/guia')">Colecta</button>
        <button class="field-quick-btn" onclick="fieldAgent._routeToSkill('suelo fertilidad')">Suelos</button>
        <button class="field-quick-btn" onclick="fieldAgent._routeToSkill('biocontrol plaga')">Biocontrol</button>
        <button class="field-quick-btn" onclick="fieldAgent._routeToSkill('fenologia etapa')">Fenología</button>
        <button class="field-quick-btn" onclick="fieldAgent.handleCommand('/ayuda')">Skills</button>
      </div>
      <div class="field-agent-input-area">
        <button class="field-voice-btn" id="fieldVoiceBtn" onclick="fieldAgent.toggleVoice()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
            <path d="M19 10v2a7 7 0 01-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
        <input type="text" class="field-agent-input" id="fieldAgentInput" placeholder="Preguntá..." onkeydown="if(event.key==='Enter')fieldAgent.sendMessage()">
        <button class="field-send-btn" onclick="fieldAgent.sendMessage()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(panel);
  }

  toggle() {
    this.isOpen = !this.isOpen;
    const panel = document.getElementById('fieldAgentPanel');
    const fab = document.getElementById('fieldAgentFab');
    if (this.isOpen) {
      panel.classList.add('open');
      fab.classList.add('active');
      document.getElementById('fieldAgentInput').focus();
      const badge = document.getElementById('fieldAgentBadge');
      if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
    } else {
      panel.classList.remove('open');
      fab.classList.remove('active');
    }
  }

  // ===== MESSAGES =====

  _addMessage(text, sender = 'agent', type = 'text') {
    const msg = { text, sender, type, time: new Date() };
    this.messages.push(msg);
    this._renderMessage(msg);
    if (!this.isOpen && sender === 'agent') {
      const badge = document.getElementById('fieldAgentBadge');
      if (badge) {
        const n = parseInt(badge.textContent || '0') + 1;
        badge.textContent = n;
        badge.style.display = '';
      }
    }
    // Auto-speak agent messages if voice enabled
    if (sender === 'agent' && type !== 'system' && this.voiceEnabled && this.isOpen) {
      this.speak(text);
    }
  }

  _addSystemMessage(text) {
    this._addMessage(text, 'agent', 'system');
  }

  _renderMessage(msg) {
    const container = document.getElementById('fieldAgentMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `field-msg field-msg-${msg.sender}`;
    if (msg.type === 'system') div.classList.add('field-msg-system');
    const time = msg.time.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      <div class="field-msg-bubble">${this._formatText(msg.text)}</div>
      <div class="field-msg-time">${time}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  _formatText(text) {
    const safe = escapeHtml(text);
    return safe
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  clearChat() {
    this.messages = [];
    const container = document.getElementById('fieldAgentMessages');
    if (container) container.innerHTML = '';
    this._addSystemMessage('Chat limpiado.');
  }

  // ===== USER INPUT =====

  sendMessage() {
    const input = document.getElementById('fieldAgentInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    this._addMessage(text, 'user');
    this._processInput(text);
  }

  _processInput(text) {
    const lower = text.toLowerCase().trim();

    if (lower.startsWith('/')) {
      this.handleCommand(lower);
      return;
    }

    // GPS intents
    if (this._match(lower, ['gps', 'ubicacion', 'posicion', 'coordenada', 'satelite', 'precision'])) {
      this._showGPSStatus();
      return;
    }

    // Collection guidance
    if (this._match(lower, ['colecta', 'muestra', 'muestreo', 'recolectar', 'cómo colecto', 'como colecto'])) {
      this._showCollectionGuide();
      return;
    }

    // Navigation
    if (this._match(lower, ['navegar', 'ir al punto', 'guiar', 'siguiente punto', 'proximo punto'])) {
      this._showNavigationHelp();
      return;
    }

    // Depth
    if (this._match(lower, ['profundidad', 'depth', 'centimetros', 'cm'])) {
      this._addMessage(
        '**Profundidad de muestreo:**\n\n' +
        '- **Caña de azúcar:** 0-20 cm (superficie) y 20-40 cm (sub)\n' +
        '- **Soja/Maíz:** 0-20 cm estándar\n' +
        '- **Pasturas:** 0-10 cm\n' +
        '- **Frutales:** 0-20 y 20-40 cm\n\n' +
        'Siempre limpiar la superficie antes de introducir el barreno.',
        'agent'
      );
      return;
    }

    // Sub-samples
    if (this._match(lower, ['sub-muestra', 'submuestra', 'cuantas', 'cantidad', 'compuesta'])) {
      this._addMessage(
        '**Sub-muestras por punto:**\n\n' +
        '- Mínimo **10-15 sub-muestras** por muestra compuesta\n' +
        '- Caminar en zigzag dentro de la zona\n' +
        '- Mezclar bien en un balde limpio\n' +
        '- Retirar ~500g de la mezcla para la muestra final\n' +
        '- Identificar con etiqueta y código del punto',
        'agent'
      );
      return;
    }

    // Equipment
    if (this._match(lower, ['barreno', 'equipo', 'herramienta', 'material', 'balde'])) {
      this._addMessage(
        '**Equipamiento necesario:**\n\n' +
        '- Barreno holandés o sonda\n' +
        '- Balde plástico limpio (sin residuos)\n' +
        '- Bolsas plásticas identificadas\n' +
        '- Etiquetas resistentes al agua\n' +
        '- Marcador permanente\n' +
        '- GPS o celular con PIX Muestreo\n' +
        '- Planilla de campo o app activa',
        'agent'
      );
      return;
    }

    // Offline / sync
    if (this._match(lower, ['offline', 'sin internet', 'sincronizar', 'sync', 'conexion'])) {
      this._addMessage(
        '**Modo Offline:**\n\n' +
        'PIX Muestreo funciona 100% sin internet:\n' +
        '- Los datos se guardan en IndexedDB local\n' +
        '- Las fotos se almacenan localmente\n' +
        '- GPS funciona sin conexión\n' +
        '- Al volver a tener internet, sincronizá con el botón de sync\n\n' +
        'Para mapas offline, pre-cargá los tiles antes de ir al campo.',
        'agent'
      );
      return;
    }

    // Error
    if (this._match(lower, ['error', 'problema', 'fallo', 'no funciona', 'bug'])) {
      this.showErrors();
      return;
    }

    // Greeting
    if (this._match(lower, ['hola', 'buenos', 'buenas', 'hey'])) {
      this._addMessage('Hola! Soy PIX Campo, tu asistente de muestreo en terreno. ¿En qué te puedo ayudar?', 'agent');
      return;
    }

    // Help
    if (this._match(lower, ['ayuda', 'help', 'que puedes', 'comandos'])) {
      this.showHelp();
      return;
    }

    // Route to agricultural skills
    const handled = this._routeToSkill(lower);
    if (handled) return;

    // Generic
    this._addMessage(
      '**PIX Campo — Skills disponibles:**\n\n' +
      '**Campo:**\n' +
      '- Estado GPS, guía colecta, profundidades, navegación\n' +
      '- Sub-muestras, equipamiento, modo offline\n\n' +
      '**Agronomía:**\n' +
      '- Suelos (pH, CTC, V%, MO, textura)\n' +
      '- Nutrientes (N, P, K, Ca, Mg, S, micros)\n' +
      '- Fertilización y encalado\n' +
      '- Biocontrol, PGPR, bioestimulantes\n' +
      '- Plagas y enfermedades en campo\n' +
      '- Fenología por cultivo\n\n' +
      'Preguntame lo que necesites o usá `/ayuda`.',
      'agent'
    );
  }

  _match(text, keywords) {
    return keywords.some(k => text.includes(k));
  }

  // ===== SKILL-BASED KNOWLEDGE ROUTER =====

  _routeToSkill(text) {
    const skills = [
      // Soil & Analysis
      { keys: ['suelo', 'fertilidad', 'analisis de suelo', 'resultado lab'], fn: () => {
        this._addMessage(
          '**Análisis de Suelo en Campo:**\n\n' +
          '**Parámetros clave a observar:**\n' +
          '- pH: <5.5 ácido (encalado), 5.5-6.5 ideal, >7 alcalino\n' +
          '- MO: <15 g/dm³ bajo, 15-30 medio, >30 alto\n' +
          '- P: Variable según método (Mehlich/Resina)\n' +
          '- V%: Meta según cultivo (soja 50-60%, caña 60%)\n' +
          '- m%: >20% = toxicidad Al, encalado urgente\n\n' +
          '**En campo notá:**\n' +
          '- Color del suelo (más oscuro = más MO)\n' +
          '- Textura al tacto (arenoso vs arcilloso)\n' +
          '- Presencia de grava, concreciones\n' +
          '- Nivel de humedad y compactación\n\n' +
          'Los resultados se procesan en PIX Admin.',
          'agent'
        );
      }},

      { keys: ['ph', 'acidez', 'alcalino'], fn: () => {
        this._addMessage(
          '**pH del Suelo:**\n- <4.5: Muy ácido (toxicidad Al)\n- 4.5-5.4: Ácido (encalado necesario)\n- 5.5-6.5: Ideal\n- 6.5-7.5: Neutro\n- >7.5: Alcalino\n\nConversión: pH CaCl₂ ≈ pH H₂O – 0.6',
          'agent'
        );
      }},

      // Nutrients
      { keys: ['nitrogeno', 'fosforo', 'potasio', 'calcio', 'magnesio', 'azufre', 'boro', 'cobre', 'hierro', 'manganeso', 'zinc'], fn: () => this._skillNutriente(text) },

      // Fertilization
      { keys: ['fertiliza', 'dosis', 'recomendacion', 'npk', 'kg/ha', 'encalado', 'cal', 'yeso', 'enmienda'], fn: () => {
        this._addMessage(
          '**Fertilización — Info rápida de campo:**\n\n' +
          '**Cálculo básico:**\n' +
          'Dosis = (Demanda - Suministro suelo) / Eficiencia\n\n' +
          '**Eficiencias referencia:**\n' +
          '- N: 50-70% | P: 20-30% | K: 60-80%\n\n' +
          '**Encalado (por V%):**\n' +
          'NC (t/ha) = CTC × (V₂ - V₁) / (10 × PRNT)\n\n' +
          '**Tips de campo:**\n' +
          '- Cal: aplicar 60-90 días antes de siembra\n' +
          '- Yeso: no altera pH, corrige subsuelo\n' +
          '- Fraccionar N en cobertura\n' +
          '- P en banda, K al voleo o en surco\n\n' +
          'Para cálculos detallados, usá PIX Admin.',
          'agent'
        );
      }},

      // Biocontrol
      { keys: ['plaga', 'enfermedad', 'biocontrol', 'beauveria', 'trichoderma', 'bt', 'mip', 'insecto', 'hongo', 'spodoptera', 'mosca', 'fusarium', 'oruga', 'gusano'], fn: () => {
        this._addMessage(
          '**Biocontrol en Campo:**\n\n' +
          '**Identificación rápida:**\n' +
          '- Tomá foto de la plaga/síntoma\n' +
          '- Anotá: hoja (vieja/nueva), patrón, distribución\n' +
          '- Contá individuos por metro/planta (umbral)\n\n' +
          '**Principales agentes:**\n' +
          '- **Beauveria:** Mosca blanca, picudo, chinches\n' +
          '- **Metarhizium:** Cigarrinha, salivazo\n' +
          '- **Bt:** Orugas (Spodoptera, Helicoverpa)\n' +
          '- **Trichoderma:** Fusarium, Rhizoctonia\n' +
          '- **Trichogramma:** Huevos de lepidópteros\n\n' +
          '**Aplicación campo:**\n' +
          '- Preferir tarde (UV baja)\n' +
          '- Humedad >60% ideal\n' +
          '- No mezclar con fungicidas sin verificar compatibilidad',
          'agent'
        );
      }},

      // PGPR / Biotech
      { keys: ['pgpr', 'azospirillum', 'bradyrhizobium', 'inoculante', 'bioinoculante', 'consorcio', 'microbiano', 'rizobacteria'], fn: () => {
        this._addMessage(
          '**Inoculantes y PGPR en Campo:**\n\n' +
          '**Aplicación de inoculantes:**\n' +
          '- **Bradyrhizobium (soja):** TS o surco, sombra, sin fungicida TS junto\n' +
          '- **Azospirillum (maíz/sorgo):** TS o surco, compatible con NPK\n' +
          '- **Trichoderma:** TS, surco o drench, almacenar refrigerado\n\n' +
          '**Tips de campo:**\n' +
          '- Inocular a la sombra, evitar sol directo\n' +
          '- No dejar semilla inoculada >4h sin sembrar\n' +
          '- Verificar fecha vencimiento\n' +
          '- Dosis: seguir etiqueta del producto\n' +
          '- Registrar lote, producto, dosis en la app',
          'agent'
        );
      }},

      // Bioestimulantes
      { keys: ['bioestimulante', 'humico', 'fulvico', 'alga', 'quitosano', 'aminoacido'], fn: () => {
        this._addMessage(
          '**Bioestimulantes en Campo:**\n\n' +
          '- **Húmicos/fúlvicos:** 2-5 L/ha suelo, 0.5-1 L/ha foliar\n' +
          '- **Extracto algas:** 1-2 L/ha foliar, anti-estrés\n' +
          '- **Aminoácidos:** Foliar en estrés o demanda alta\n' +
          '- **Quitosano:** Elicitor defensa + antimicrobiano\n\n' +
          '**Momento:** Crecimiento activo, pre/post-estrés, floración.',
          'agent'
        );
      }},

      // Fenología
      { keys: ['fenologia', 'etapa', 'floracion', 'macollaje', 'maduracion', 'llenado', 'crecimiento'], fn: () => {
        this._addMessage(
          '**Etapas Fenológicas — Referencia rápida:**\n\n' +
          '**Caña:** Brotación → Macollaje → Gran crecimiento → Maduración\n' +
          '**Soja:** VE → VC → V1-Vn → R1(flor) → R3-R5(vaina) → R7-R8\n' +
          '**Maíz:** VE → V2-V6 → V8-V12 → VT(espiga) → R1-R6\n\n' +
          '**En campo registrá:**\n' +
          '- Etapa fenológica actual del cultivo\n' +
          '- Altura de planta y cobertura estimada\n' +
          '- Síntomas visibles (clorosis, necrosis, plagas)\n' +
          '- Foto del estado del cultivo',
          'agent'
        );
      }},

      // Zonas de manejo (campo)
      { keys: ['zona', 'ambiente', 'manejo', 'alta', 'baja', 'productividad'], fn: () => {
        this._addMessage(
          '**Zonas de Manejo en Campo:**\n\n' +
          '**Qué observar por zona:**\n' +
          '- Diferencias de vigor (color, altura)\n' +
          '- Textura y color del suelo\n' +
          '- Topografía (alto, bajo, ladera)\n' +
          '- Drenaje y acumulación de agua\n' +
          '- Historial de rendimiento\n\n' +
          '**Al muestrear por zona:**\n' +
          '- No mezclar muestras de zonas distintas\n' +
          '- Respetar los límites del grid/zona\n' +
          '- Anotar observaciones por zona\n' +
          '- Foto representativa de cada zona',
          'agent'
        );
      }},

      // Contaminación / cuidados
      { keys: ['contamina', 'cuidado', 'limpi', 'protocolo', 'higiene', 'bpa'], fn: () => {
        this._addMessage(
          '**Cuidados para Evitar Contaminación:**\n\n' +
          '- Limpiar barreno entre puntos distintos\n' +
          '- No tocar muestra con manos (usar guantes)\n' +
          '- Balde exclusivo (sin restos de fertilizante)\n' +
          '- Evitar bordes de caminos, hormigueros, surcos fertilizados\n' +
          '- No muestrear después de aplicación reciente\n' +
          '- Mantener muestras en lugar fresco y seco\n' +
          '- Enviar al lab en <48h si es posible',
          'agent'
        );
      }},

      // DataFarm / IBRA
      { keys: ['datafarm', 'ibra', 'lab online', 'resultado'], fn: () => {
        this._addMessage(
          '**DataFarm / IBRA — Desde Campo:**\n\n' +
          '- **IBRA Coleta app:** Para georeferenciar muestras\n' +
          '- **DataFarm Coleta:** Alternativa con zonas de manejo\n' +
          '- **PIX Muestreo:** Nuestra app (esta!) con GPS optimizado\n\n' +
          '**Flujo:**\n' +
          '1. Colectar con PIX Muestreo (GPS + foto + datos)\n' +
          '2. Enviar muestras a IBRA megalab\n' +
          '3. Resultados llegan por email (CSV)\n' +
          '4. Importar en PIX Admin para análisis completo',
          'agent'
        );
      }},
    ];

    for (const skill of skills) {
      if (this._match(text, skill.keys)) {
        skill.fn();
        return true;
      }
    }
    return false;
  }

  _skillNutriente(text) {
    const info = {
      'nitrogeno': '**N:** Proteínas, clorofila. Deficiencia = amarillamiento hojas viejas. Fuentes: Urea 45%N, sulfato amonio 21%N+24%S',
      'fosforo': '**P:** Raíces, energía, semillas. Deficiencia = púrpura hojas viejas. Fuentes: MAP 52%P₂O₅, SFT 46%',
      'potasio': '**K:** Estomas, calidad, resistencia. Deficiencia = necrosis bordes hojas viejas. Fuentes: KCl 60%K₂O',
      'calcio': '**Ca:** Pared celular, frutos. Deficiencia = BER tomate, tip burn. Fuentes: Cal, yeso, nitrato Ca',
      'magnesio': '**Mg:** Centro clorofila. Deficiencia = clorosis internerval hojas viejas. Fuentes: Cal dolomítica, sulfato Mg',
      'azufre': '**S:** Aminoácidos, aceites. Deficiencia = amarillamiento hojas NUEVAS. Fuentes: Sulfato amonio, yeso',
      'boro': '**B:** Polen, pared celular. Deficiencia = corazón hueco, frutos deformes. Fuentes: Bórax, ácido bórico',
      'cobre': '**Cu:** Enzimas, lignina. Deficiencia = hojas enrolladas, espigas vacías. Fuentes: Sulfato Cu',
      'hierro': '**Fe:** Clorofila. Deficiencia = clorosis hojas JÓVENES (pH alto). Fuentes: Quelatos Fe-EDDHA',
      'manganeso': '**Mn:** Fotosíntesis. Deficiencia = clorosis moteada hojas jóvenes (¡soja!). Fuentes: Sulfato Mn',
      'zinc': '**Zn:** Auxinas. Deficiencia = hojas pequeñas, entrenudos cortos. Fuentes: Sulfato Zn (maíz sensible)'
    };
    for (const [key, val] of Object.entries(info)) {
      if (text.includes(key)) {
        this._addMessage(val, 'agent');
        return;
      }
    }
    this._addMessage('Preguntame sobre: N, P, K, Ca, Mg, S, B, Cu, Fe, Mn, Zn.', 'agent');
  }

  // ===== COMMANDS =====

  handleCommand(cmd) {
    const command = cmd.replace('/', '').trim().split(' ')[0];
    switch (command) {
      case 'gps': this._showGPSStatus(); break;
      case 'guia': this._showCollectionGuide(); break;
      case 'errores': this.showErrors(); break;
      case 'ayuda': case 'help': this.showHelp(); break;
      case 'voz': this.toggleVoice(); break;
      case 'limpiar': this.clearChat(); break;
      case 'navegar': this._showNavigationHelp(); break;
      case 'offline': this._showOfflineStatus(); break;
      default:
        this._addMessage(`Comando desconocido: \`/${command}\`. Usá \`/ayuda\`.`, 'agent');
    }
  }

  showHelp() {
    this._addMessage(
      '**Comandos disponibles:**\n\n' +
      '`/gps` — Estado del GPS y precisión\n' +
      '`/guia` — Guía paso a paso de colecta\n' +
      '`/navegar` — Ayuda de navegación a puntos\n' +
      '`/errores` — Ver errores del sistema\n' +
      '`/offline` — Estado del modo offline\n' +
      '`/voz` — Activar/desactivar voz\n' +
      '`/limpiar` — Limpiar chat\n\n' +
      '**Skills agrícolas (preguntá directamente):**\n' +
      '- Suelos, pH, nutrientes, fertilización, encalado\n' +
      '- Biocontrol, plagas, enfermedades, PGPR\n' +
      '- Inoculantes, bioestimulantes, consorcios\n' +
      '- Fenología, zonas de manejo en campo\n' +
      '- Profundidad, sub-muestras, equipamiento\n' +
      '- DataFarm, IBRA, protocolo BPA',
      'agent'
    );
  }

  // ===== GPS STATUS =====

  _showGPSStatus() {
    const gps = window.gpsManager;
    if (!gps) {
      this._addMessage('GPS Manager no disponible. Verificá que la app esté correctamente cargada.', 'agent');
      return;
    }

    const pos = gps.currentPosition;
    const accuracy = pos ? pos.accuracy : null;
    const warmedUp = gps.warmedUp || false;
    const stabilized = gps.stabilized || false;
    const canCollect = gps.canCollect ? gps.canCollect() : false;

    let qualityIcon = '🔴';
    let qualityText = 'Sin señal';
    if (accuracy !== null) {
      if (accuracy <= 5) { qualityIcon = '🟢'; qualityText = 'Excelente'; }
      else if (accuracy <= 10) { qualityIcon = '🟡'; qualityText = 'Buena'; }
      else if (accuracy <= 20) { qualityIcon = '🟠'; qualityText = 'Aceptable'; }
      else { qualityIcon = '🔴'; qualityText = 'Pobre'; }
    }

    let msg = `**Estado GPS:**\n\n`;
    msg += `Calidad: ${qualityIcon} **${qualityText}**\n`;
    msg += `Precisión: **${accuracy ? accuracy.toFixed(1) + 'm' : 'N/A'}**\n`;
    msg += `Warm-up: **${warmedUp ? 'Completo' : 'En progreso...'}**\n`;
    msg += `Estabilizado: **${stabilized ? 'Sí' : 'No'}**\n`;
    msg += `Puede colectar: **${canCollect ? 'SÍ' : 'NO — esperá estabilización'}**\n`;

    if (pos) {
      msg += `\nCoord: ${pos.latitude.toFixed(6)}, ${pos.longitude.toFixed(6)}`;
    }

    if (!canCollect && pos) {
      msg += '\n\n**Consejo:** Mantené el celular quieto en posición elevada y esperá a que se estabilice la señal.';
    }

    this._addMessage(msg, 'agent');
  }

  // ===== COLLECTION GUIDE =====

  _showCollectionGuide() {
    this._addMessage(
      '**Guía de Colecta de Muestras:**\n\n' +
      '**1. Antes de colectar:**\n' +
      '- Verificá que el GPS esté estabilizado (`/gps`)\n' +
      '- Limpiá el barreno entre puntos\n' +
      '- Confirmá la profundidad según el cultivo\n\n' +
      '**2. En cada punto:**\n' +
      '- Esperá señal GPS verde (precisión < 5m)\n' +
      '- Limpiar hojarasca/residuos de la superficie\n' +
      '- Insertar barreno a la profundidad definida\n' +
      '- Tomar 10-15 sub-muestras en zigzag\n' +
      '- Mezclar en balde limpio\n' +
      '- Retirar ~500g para la bolsa\n\n' +
      '**3. Identificación:**\n' +
      '- Etiquetar con código del punto\n' +
      '- Tomar foto del punto\n' +
      '- Anotar observaciones (piedras, color, humedad)\n\n' +
      '**4. Después:**\n' +
      '- Guardar la muestra en la app\n' +
      '- Mantener bolsas en lugar fresco y seco\n' +
      '- Sincronizar datos cuando haya internet',
      'agent'
    );
  }

  // ===== NAVIGATION =====

  _showNavigationHelp() {
    this._addMessage(
      '**Navegación a Puntos:**\n\n' +
      'En el mapa de PIX Muestreo:\n' +
      '- Los puntos pendientes aparecen como marcadores\n' +
      '- Tu posición se muestra con un punto azul\n' +
      '- Tocá un marcador para ver distancia y dirección\n\n' +
      '**Tips:**\n' +
      '- Activá la brújula del celular para orientarte\n' +
      '- Caminá hacia el punto hasta estar a <5m\n' +
      '- Esperá que el GPS se estabilice antes de colectar\n' +
      '- Usá referencias visuales del terreno (árboles, caminos)',
      'agent'
    );
  }

  // ===== OFFLINE STATUS =====

  _showOfflineStatus() {
    const online = navigator.onLine;
    const swActive = 'serviceWorker' in navigator;

    let msg = `**Estado Offline:**\n\n`;
    msg += `Conexión: **${online ? 'Online' : 'Offline'}**\n`;
    msg += `Service Worker: **${swActive ? 'Activo' : 'No disponible'}**\n`;

    // Check caches
    if ('caches' in window) {
      caches.keys().then(names => {
        msg += `Caches: **${names.length}** (${names.join(', ')})\n`;
        this._addMessage(msg, 'agent');
      });
    } else {
      msg += 'Cache API: No disponible';
      this._addMessage(msg, 'agent');
    }
  }

  // ===== ERROR MONITORING =====

  _setupErrorMonitor() {
    window.addEventListener('error', (event) => {
      this.errorLog.push({
        type: 'error',
        message: event.message || 'Error desconocido',
        file: event.filename,
        line: event.lineno,
        time: new Date()
      });
      if (this.isOpen) {
        this._addMessage(`Error: \`${event.message}\``, 'agent', 'system');
      } else {
        const badge = document.getElementById('fieldAgentBadge');
        if (badge) {
          const n = parseInt(badge.textContent || '0') + 1;
          badge.textContent = n;
          badge.style.display = '';
        }
      }
    });

    window.addEventListener('unhandledrejection', (event) => {
      const msg = event.reason ? (event.reason.message || String(event.reason)) : 'Promise rejected';
      this.errorLog.push({ type: 'promise', message: msg, time: new Date() });
    });

    // Monitor GPS health
    setInterval(() => this._gpsHealthCheck(), 30000);
  }

  _gpsHealthCheck() {
    const gps = window.gpsManager;
    if (!gps) return;

    // Alert if GPS lost
    if (gps.currentPosition && gps.currentPosition.accuracy > 50) {
      this._addSystemMessage('Advertencia: Precisión GPS degradada (>' + Math.round(gps.currentPosition.accuracy) + 'm). Buscá un área abierta.');
    }
  }

  showErrors() {
    if (this.errorLog.length === 0) {
      this._addMessage('Sin errores registrados. Todo funciona bien.', 'agent');
      return;
    }
    const last5 = this.errorLog.slice(-5);
    let text = `**Últimos ${last5.length} errores:**\n\n`;
    last5.forEach((e, i) => {
      const time = e.time.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      text += `${i + 1}. \`[${time}]\` ${e.message}\n`;
    });
    this._addMessage(text, 'agent');
  }

  // ===== VOICE =====

  _setupSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    this.recognition = new SR();
    this.recognition.lang = 'es-AR';
    this.recognition.continuous = false;
    this.recognition.interimResults = false;

    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      this._addMessage(transcript, 'user');
      this._processInput(transcript);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      const btn = document.getElementById('fieldVoiceBtn');
      if (btn) btn.classList.remove('listening');
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      const btn = document.getElementById('fieldVoiceBtn');
      if (btn) btn.classList.remove('listening');
    };
  }

  toggleVoice() {
    if (!this.recognition) {
      this._addMessage('Voz no disponible en este navegador.', 'agent');
      return;
    }
    if (this.isListening) {
      this.recognition.stop();
      this.isListening = false;
    } else {
      try {
        this.recognition.start();
        this.isListening = true;
        const btn = document.getElementById('fieldVoiceBtn');
        if (btn) btn.classList.add('listening');
        this._addMessage('Escuchando...', 'agent', 'system');
      } catch (e) {
        this._addMessage('Error al iniciar micrófono.', 'agent');
      }
    }
  }

  speak(text) {
    if (!this.synthesis || !this.voiceEnabled) return;
    this.synthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text.replace(/\*\*/g, '').replace(/`/g, ''));
    utt.lang = 'es-AR';
    utt.rate = 1.1;
    const voices = this.synthesis.getVoices();
    const esVoice = voices.find(v => v.lang.startsWith('es'));
    if (esVoice) utt.voice = esVoice;
    utt.onstart = () => { this.isSpeaking = true; };
    utt.onend = () => { this.isSpeaking = false; };
    this.synthesis.speak(utt);
  }
}

// ===== GLOBAL INIT =====
let fieldAgent;
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    fieldAgent = new PixFieldAgent();
    fieldAgent.init();
    window.fieldAgent = fieldAgent;
  }, 800);
});
