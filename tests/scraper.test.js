import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { _testUtils } from "../src/scraper.js";

const { filterByKeywords, dedupe, toCsv, normalizeSearchValue } = _testUtils;

describe("normalizeSearchValue", () => {
  it("convierte a minusculas", () => {
    assert.equal(normalizeSearchValue("HOLA"), "hola");
  });

  it("elimina acentos", () => {
    assert.equal(normalizeSearchValue("bebé"), "bebe");
    assert.equal(normalizeSearchValue("artículo"), "articulo");
  });

  it("recorta espacios", () => {
    assert.equal(normalizeSearchValue("  hola  "), "hola");
  });

  it("maneja null y undefined", () => {
    assert.equal(normalizeSearchValue(null), "");
    assert.equal(normalizeSearchValue(undefined), "");
  });
});

describe("filterByKeywords", () => {
  const items = [
    { title: "Mi Manual del Bebé", url: "https://example.com/1" },
    { title: "Recetas de cocina", url: "https://example.com/2" },
    { title: "Guía para mamás", url: "https://example.com/3" },
  ];

  it("filtra items que coinciden con keyword", () => {
    const result = filterByKeywords(items, ["manual del bebe"]);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, "Mi Manual del Bebé");
  });

  it("ignora acentos al buscar", () => {
    const result = filterByKeywords(items, ["bebe"]);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, "Mi Manual del Bebé");
  });

  it("busqueda case-insensitive", () => {
    const result = filterByKeywords(items, ["RECETAS"]);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, "Recetas de cocina");
  });

  it("retorna todos con matchedKeywords vacio si no hay keywords", () => {
    const result = filterByKeywords(items, []);
    assert.equal(result.length, 3);
    assert.deepEqual(result[0].matchedKeywords, []);
  });

  it("retorna vacio si ninguno coincide", () => {
    const result = filterByKeywords(items, ["inexistente"]);
    assert.equal(result.length, 0);
  });

  it("incluye multiples keywords coincidentes", () => {
    const result = filterByKeywords(items, ["manual", "mamas"]);
    assert.equal(result.length, 2);
  });

  it("agrega matchedKeywords al resultado", () => {
    const result = filterByKeywords(items, ["manual del bebe"]);
    assert.deepEqual(result[0].matchedKeywords, ["manual del bebe"]);
  });
});

describe("dedupe", () => {
  it("elimina duplicados exactos", () => {
    const items = [
      { url: "https://a.com", title: "A", summary: "S" },
      { url: "https://a.com", title: "A", summary: "S" },
      { url: "https://b.com", title: "B", summary: "S" },
    ];
    const result = dedupe(items);
    assert.equal(result.length, 2);
  });

  it("mantiene items unicos", () => {
    const items = [
      { url: "https://a.com", title: "A", summary: "1" },
      { url: "https://a.com", title: "A", summary: "2" },
    ];
    const result = dedupe(items);
    assert.equal(result.length, 2);
  });

  it("maneja items sin url", () => {
    const items = [
      { title: "A", summary: "S" },
      { title: "A", summary: "S" },
    ];
    const result = dedupe(items);
    assert.equal(result.length, 1);
  });

  it("retorna vacio para array vacio", () => {
    assert.equal(dedupe([]).length, 0);
  });
});

describe("toCsv", () => {
  it("retorna vacio para array vacio", () => {
    assert.equal(toCsv([]), "");
  });

  it("genera headers y filas correctamente", () => {
    const items = [{ title: "Hola", url: "https://a.com" }];
    const csv = toCsv(items);
    const lines = csv.replace("\uFEFF", "").split("\r\n");
    assert.equal(lines[0], '"title","url"');
    assert.equal(lines[1], '"Hola","https://a.com"');
  });

  it("incluye BOM UTF-8", () => {
    const csv = toCsv([{ a: "1" }]);
    assert.ok(csv.startsWith("\uFEFF"));
  });

  it("escapa comillas dobles", () => {
    const items = [{ title: 'Dice "hola"' }];
    const csv = toCsv(items);
    assert.ok(csv.includes('Dice ""hola""'));
  });

  it("maneja saltos de linea en valores", () => {
    const items = [{ title: "Linea1\nLinea2" }];
    const csv = toCsv(items);
    const bom = csv.replace("\uFEFF", "");
    assert.ok(bom.includes('"Linea1\nLinea2"'));
  });

  it("convierte arrays a texto separado por pipe", () => {
    const items = [{ keywords: ["a", "b", "c"] }];
    const csv = toCsv(items);
    assert.ok(csv.includes("a | b | c"));
  });

  it("usa CRLF como separador de lineas", () => {
    const items = [{ a: "1" }, { a: "2" }];
    const csv = toCsv(items).replace("\uFEFF", "");
    assert.ok(csv.includes("\r\n"));
  });
});
