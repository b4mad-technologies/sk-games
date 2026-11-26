import { type TSchema, Type } from "typebox";

interface JsonSchema {
	type?: string | string[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
	enum?: unknown[];
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	description?: string;
	minimum?: number;
	maximum?: number;
	minItems?: number;
	maxItems?: number;
	minLength?: number;
	maxLength?: number;
}

function options(schema: JsonSchema): Record<string, unknown> {
	return schema.description === undefined ? {} : { description: schema.description };
}

function jsonSchemaToTypeBox(schema: JsonSchema): TSchema {
	if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
		const [first, ...rest] = schema.anyOf;
		if (first === undefined) return Type.Unknown();
		if (rest.length === 0) return jsonSchemaToTypeBox(first);
		return Type.Union([jsonSchemaToTypeBox(first), ...rest.map(jsonSchemaToTypeBox)]);
	}
	if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
		const [first, ...rest] = schema.oneOf;
		if (first === undefined) return Type.Unknown();
		if (rest.length === 0) return jsonSchemaToTypeBox(first);
		return Type.Union([jsonSchemaToTypeBox(first), ...rest.map(jsonSchemaToTypeBox)]);
	}
	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		const literals = schema.enum.filter(
			(value): value is string | number | boolean =>
				typeof value === "string" || typeof value === "number" || typeof value === "boolean",
		);
		if (literals.length === 1) return Type.Literal(literals[0] as string | number | boolean);
		if (literals.length > 1) {
			return Type.Union(literals.map((value) => Type.Literal(value)));
		}
	}
	const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
	if (type === "string") {
		return Type.String({
			...options(schema),
			...(schema.minLength === undefined ? {} : { minLength: schema.minLength }),
			...(schema.maxLength === undefined ? {} : { maxLength: schema.maxLength }),
		});
	}
	if (type === "integer") {
		return Type.Integer({
			...options(schema),
			...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
			...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
		});
	}
	if (type === "number") {
		return Type.Number({
			...options(schema),
			...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
			...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
		});
	}
	if (type === "boolean") return Type.Boolean(options(schema));
	if (type === "array") {
		const items = schema.items === undefined ? Type.Unknown() : jsonSchemaToTypeBox(schema.items);
		return Type.Array(items, {
			...options(schema),
			...(schema.minItems === undefined ? {} : { minItems: schema.minItems }),
			...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems }),
		});
	}
	if (type === "object" || schema.properties !== undefined) {
		const required = new Set(schema.required ?? []);
		const properties: Record<string, TSchema> = {};
		for (const [key, value] of Object.entries(schema.properties ?? {})) {
			const inner = jsonSchemaToTypeBox(value);
			properties[key] = required.has(key) ? inner : Type.Optional(inner);
		}
		return Type.Object(properties, options(schema));
	}
	return Type.Unknown();
}

/** Fallback when a listed MCP tool is not in `@spellkave/tool-contracts`. */
export function typeBoxFromJsonSchema(schema: unknown): TSchema {
	if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
		return Type.Unknown();
	}
	return jsonSchemaToTypeBox(schema as JsonSchema);
}
