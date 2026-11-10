#!/usr/bin/env python3
"""«05 Sales-Book» corregido, PAUSADO, listo para cuando pase el descanso.

POR QUE UNO NUEVO Y NO EDITAR EL VIEJO. Dos razones que empujan igual:
  1. el viejo tiene TRES afirmaciones que no se sostienen (abajo), y editarlas
     en el anuncio vivo le cambia el creativo a un objeto con historial;
  2. esta fatigado, y un objeto nuevo tambien reinicia las senales de entrega.
Arreglar y renovar son la misma operacion, asi que se hace una sola vez.

LA FATIGA, MEDIDA. No es una impresion: el CPM BAJO mientras el costo por
checkout MAS QUE DUPLICO, que es la unica firma que distingue fatiga de
subasta cara.

    dia       gasto    CPM   visitas  checkouts  $/checkout  compras
    7/11      99,68  22,84     120       24         4,15        2
    8/11      53,77  18,77      71       10         5,38        3
    9/11      29,00  16,39      40        3         9,67        0

    conversion de visita a checkout:  20 % -> 14 % -> 7,5 %

LOS TRES ARREGLOS, y el tercero es el que importa:

  1. «104 illustrated pages» -> 95. El 104 existe, pero son los 104 TERMINOS
     del glosario, no paginas. El libro va de la pagina 5 a la 95 en 7 partes.
     En la version nueva el 104 se usa bien, nombrando lo que de verdad es.

  2. «Link in bio» -> fuera. En un anuncio pago con boton promete algo que no
     esta: el clic ya lleva a la landing.

  3. «The exact moments where marks get lost -- and how to stop losing them»
     -> fuera. Eso es lo que promete **Physics Marked**, que NO viene en el
     Kit: se vende aparte a 9,99 y es un escalon del post-pago. El anuncio que
     hizo 97 de las 122 compras de la campania estaba prometiendo un producto
     que el comprador no recibe. Es la causa de reembolso mas cara que hay.

LO QUE NO SE TOCA: el video (1043466695359156, el que ya vendio), el boton
SEE_DETAILS, el destino y la forma del copy -- titulo, cuerpo con flechas y
`link_description`. Lo que funciona se conserva; lo que no es cierto, se saca.

CADA VINIETA SALE DE LA LANDING, parte por parte: Fundamentals pp. 5-16,
Mechanics 17-34, Fluids 35-46, Thermodynamics 47-58, Electricity 59-72,
Waves & Optics 73-84. Y los dos bonos con su nombre publicado.

Uso:
    python3 anuncio-salesbook-v2.py            # ensayo
    python3 anuncio-salesbook-v2.py --crear    # lo crea PAUSADO
"""
import argparse, importlib.util, json, pathlib, sys

RAIZ = pathlib.Path(__file__).parent
CONJUNTO = "120247559041460519"          # «Physics | Broad UK», el que corre
VIDEO = "1043466695359156"               # el mismo video de 05 Sales-Book
DESTINO = "https://www.physicsstudylab.com/"

CUERPO = """🧠 Physics that finally makes sense.

Not "memorise the formula and hope." See what is actually happening, page by page.

→ Motion, force and Newton's laws — what is going on, not just the rule
→ Pressure and density: Pascal, Archimedes and Bernoulli, in everyday examples
→ Heat, temperature, gases and entropy, with the context the formulas never carry
→ Charge, electric field, current and resistance — one idea at a time
→ Sound, light, reflection and refraction, with diagrams that hold still
→ Relativity and quantum, without the spiral

95 illustrated pages across 7 parts, plus 2 bonuses: The Words of Physics (104 terms, illustrated) and 30 Rapid Revision Cards on the topics that come up most.

GCSE and A-Level.
✅ Instant PDF — read it on any device, or print it
🔒 30-day no-questions guarantee

#physicsstudylab #gcsephysics #alevelphysics #physicsrevision #sciencerevision #studytips #ukstudents #revisionnotes #studygram #examseason"""

spec = importlib.util.spec_from_file_location("c", RAIZ / "campanas-za-au.py")
mod = importlib.util.module_from_spec(spec)
_a = sys.argv[:]; sys.argv = ["x", "--listar"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _a
meta, ACT, PAGINA, IG = mod.meta, mod.ACT, mod.PAGINA, mod.IG

# Lo que NO puede decir la version nueva. Si alguna aparece, no se crea.
PROHIBIDO = ["Link in bio", "104 illustrated pages", "104 pages", "marks get lost"]


def main(ensayo):
    malas = [x for x in PROHIBIDO if x.lower() in CUERPO.lower()]
    if malas:
        sys.exit(f"  NO lo creo: el cuerpo todavia dice {malas}")
    print("\n### 05 Sales-Book v2 — corregido")
    print(f"    conjunto {CONJUNTO} · video {VIDEO} (el mismo que vendio)")
    print(f"    {len(CUERPO)} caracteres · dice «95 illustrated pages»: "
          f"{'95 illustrated pages' in CUERPO}")
    print(f"    las tres frases retiradas: {', '.join(PROHIBIDO[:3])} — ninguna presente")
    if ensayo:
        return print("\n    [ensayo: no se escribio nada]\n")

    thumb = mod.miniatura(VIDEO)
    if not thumb:
        return print("    ERROR: Meta no dio miniatura")
    historia = {"page_id": PAGINA, "video_data": {
        "video_id": VIDEO, "image_url": thumb,
        "title": "Physics Study Lab: the full kit 📘",
        "message": CUERPO,
        "link_description": "Instant PDF · 2 bonuses · 30-day guarantee",
        "call_to_action": {"type": "SEE_DETAILS", "value": {"link": DESTINO}}}}
    campos = {"name": "05 Sales-Book v2 (95 pp)",
              "degrees_of_freedom_spec": json.dumps(mod.automatizaciones())}

    con_ig = dict(historia); con_ig["instagram_user_id"] = IG
    ok, cre = meta("POST", f"{ACT}/adcreatives", {**campos, "object_story_spec": json.dumps(con_ig)})
    ident = "studylab.ok"
    if not ok:
        ok, cre = meta("POST", f"{ACT}/adcreatives", {**campos, "object_story_spec": json.dumps(historia)})
        ident = "SIN IDENTIDAD"
    if not ok:
        return print(f"    ERROR creativo: {cre}")

    ok, ad = meta("POST", f"{ACT}/ads", {
        "name": "05 Sales-Book v2 (95 pp)", "adset_id": CONJUNTO,
        "creative": json.dumps({"creative_id": cre["id"]}), "status": "PAUSED"})
    if not ok:
        return print(f"    ERROR anuncio: {ad}")
    print(f"\n    anuncio {ad['id']}  PAUSADO  ({ident})")
    print("    Prenderlo recien despues del descanso: 10 a 14 dias desde el 9/11.\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--crear", action="store_true")
    main(ensayo=not ap.parse_args().crear)
