/**
 * Puerto de recepción de solicitudes.
 * La UI depende de LeadService, no de un proveedor concreto.
 * SimulatedLeadService es el adaptador de esta prueba: valida en local,
 * no llama a ninguna red, no persiste datos y no usa secretos.
 * Un adaptador real sustituye el export `leadService` sin cambiar el formulario.
 */

export const CLIENT_TYPES = ["hogar", "autonomo", "pyme"] as const;

export type ClientType = (typeof CLIENT_TYPES)[number];

export type FieldName = "name" | "phone" | "email" | "clientType" | "message";

export type FieldErrorCode = "invalid" | "too-long";

export interface LeadDraft {
  name: string;
  phone: string;
  email: string;
  clientType: string;
  message: string;
  honeypot: string;
}

export interface Lead {
  name: string;
  phone: string;
  email: string;
  clientType: ClientType;
  message: string;
}

export interface FieldError {
  field: FieldName;
  code: FieldErrorCode;
}

export type LeadInspection =
  | { status: "invalid"; errors: FieldError[] }
  | { status: "discarded"; reason: "honeypot" }
  | { status: "ready"; lead: Lead };

export type LeadSubmitResult =
  | {
      status: "accepted";
      reference: string;
      transmitted: boolean;
      detail: string;
    }
  | { status: "discarded"; reason: "honeypot" }
  | { status: "invalid"; errors: FieldError[] }
  | { status: "failed"; detail: string };

export interface LeadService {
  inspect(draft: LeadDraft): LeadInspection;
  submit(draft: LeadDraft): Promise<LeadSubmitResult>;
}

type LogData = Record<string, string | number | boolean>;

const NAME_PATTERN = /^[\p{L}][\p{L}\s.'-]{1,79}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SPANISH_PHONE_PATTERN = /^(?:\+34|0034)?[6789]\d{8}$/;
const MESSAGE_MIN_LENGTH = 15;
const MESSAGE_MAX_LENGTH = 800;
const NAME_MAX_LENGTH = 80;
const EMAIL_MAX_LENGTH = 254;

/** TEMPORAL: la pausa solo vuelve perceptible el estado de carga. No simula una red. */
const LOCAL_ACCEPTANCE_DELAY_MS = 350;

function isDevelopment(): boolean {
  const env = import.meta.env;
  return Boolean(env && env.DEV);
}

/** TEMPORAL: diagnóstico de validación. Retirar cuando el flujo de envío esté estable. */
function logTemporary(context: string, data: LogData): void {
  if (!isDevelopment()) return;
  console.info(`[LeadService] ${context}`, data);
}

/**
 * AUDITORÍA: resultado del caso de uso, sin datos personales.
 * En esta prueba solo se emite en desarrollo. Un adaptador real debe
 * mandarla a un logger de servidor, nunca al navegador.
 */
function logAudit(context: string, data: LogData): void {
  if (!isDevelopment()) return;
  console.info(`[LeadService] ${context}`, data);
}

/** TEMPORAL: fallos no previstos. No incluir el borrador ni el mensaje de error si puede arrastrar datos. */
function logUnexpected(context: string, data: LogData): void {
  if (!isDevelopment()) return;
  console.error(`[LeadService] ${context}`, data);
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizePhone(value: string): string {
  return value.trim().replace(/[\s.\-()]/g, "");
}

function isClientType(value: string): value is ClientType {
  return (CLIENT_TYPES as readonly string[]).includes(value);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createLocalReference(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return `local-${uuid}`;
}

function inspectDraft(draft: LeadDraft): LeadInspection {
  if (draft.honeypot.trim() !== "") {
    logAudit("Solicitud descartada", {
      context: "SimulatedLeadService.inspect",
      reason: "honeypot",
    });
    return { status: "discarded", reason: "honeypot" };
  }

  const errors: FieldError[] = [];
  const name = cleanName(draft.name);
  const phone = normalizePhone(draft.phone);
  const email = draft.email.trim().toLowerCase();
  const clientType = draft.clientType.trim();
  const message = draft.message.trim().replace(/\s+/g, " ");

  if (name.length > NAME_MAX_LENGTH) {
    errors.push({ field: "name", code: "too-long" });
  } else if (!NAME_PATTERN.test(name)) {
    errors.push({ field: "name", code: "invalid" });
  }

  if (!SPANISH_PHONE_PATTERN.test(phone)) {
    errors.push({ field: "phone", code: "invalid" });
  }

  if (email.length > EMAIL_MAX_LENGTH) {
    errors.push({ field: "email", code: "too-long" });
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.push({ field: "email", code: "invalid" });
  }

  if (!isClientType(clientType)) {
    errors.push({ field: "clientType", code: "invalid" });
  }

  if (message.length > MESSAGE_MAX_LENGTH) {
    errors.push({ field: "message", code: "too-long" });
  } else if (message.length < MESSAGE_MIN_LENGTH) {
    errors.push({ field: "message", code: "invalid" });
  }

  if (errors.length > 0) {
    logTemporary("Validación rechazada", {
      context: "SimulatedLeadService.inspect",
      fields: errors.map((error) => error.field).join(","),
      count: errors.length,
    });
    return { status: "invalid", errors };
  }

  if (!isClientType(clientType)) {
    return {
      status: "invalid",
      errors: [{ field: "clientType", code: "invalid" }],
    };
  }

  return {
    status: "ready",
    lead: {
      name,
      phone,
      email,
      clientType,
      message,
    },
  };
}

export class SimulatedLeadService implements LeadService {
  private readonly acceptanceDelayMs: number;

  constructor(acceptanceDelayMs = LOCAL_ACCEPTANCE_DELAY_MS) {
    this.acceptanceDelayMs = acceptanceDelayMs;
  }

  inspect(draft: LeadDraft): LeadInspection {
    return inspectDraft(draft);
  }

  async submit(draft: LeadDraft): Promise<LeadSubmitResult> {
    try {
      const inspection = this.inspect(draft);

      if (
        inspection.status === "invalid" ||
        inspection.status === "discarded"
      ) {
        return inspection;
      }

      if (inspection.status !== "ready") {
        const unexpected: never = inspection;
        logUnexpected("Inspección no contemplada", {
          context: "SimulatedLeadService.submit",
          status: String(unexpected),
        });
        return {
          status: "failed",
          detail: "No se pudo completar la validación local.",
        };
      }

      await wait(this.acceptanceDelayMs);

      const reference = createLocalReference();
      logAudit("Solicitud aceptada en local", {
        context: "SimulatedLeadService.submit",
        reference,
        clientType: inspection.lead.clientType,
        transmitted: false,
      });

      return {
        status: "accepted",
        reference,
        transmitted: false,
        detail: "Solicitud aceptada por el adaptador de demostración.",
      };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      logUnexpected("Fallo inesperado al aceptar en local", {
        context: "SimulatedLeadService.submit",
        errorName,
      });
      return {
        status: "failed",
        detail: "No se pudo completar la validación local.",
      };
    }
  }
}

export const leadService: LeadService = new SimulatedLeadService();
