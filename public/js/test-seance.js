// Séance test : vérifier les sons et les signaux avec le vrai moteur de séance, en 42 s.
// Que des étapes de 10 s : course, marche, course, récupération. Elle ne compte nulle part : pas d'historique, pas de bilan, pas de reprise,
// pas d'effet sur le programme. Le marqueur `test` la suit partout (session.test).

export const TEST_ID = 'test-signaux';

export function testSession() {
  const step = (kind) => ({ kind, duration: 10 });
  return {
    id: TEST_ID,
    test: true,
    name: 'Séance test',
    leadIn: 2, // premier signal 2 s après « Je suis prêt » (7 s dans une vraie séance)
    steps: [step('course_lente'), step('marche'), step('course_lente'), step('recuperation')],
  };
}

export const isTest = (session) => Boolean(session?.test);
