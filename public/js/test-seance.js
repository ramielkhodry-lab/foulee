// Séance test : vérifier les sons et les signaux avec le vrai moteur de séance, en 1 min 30.
// Même déroulé qu'une vraie course (échauffement, courses séparées de marches, récupération),
// en secondes. Elle ne compte nulle part : pas d'historique, pas de bilan, pas de reprise,
// pas d'effet sur le programme. Le marqueur `test` la suit partout (session.test).

export const TEST_ID = 'test-signaux';

export function testSession() {
  const run = { kind: 'course_lente', duration: 10 };
  const walk = { kind: 'marche', duration: 5 };
  return {
    id: TEST_ID,
    test: true,
    name: 'Séance test',
    steps: [
      { kind: 'echauffement', duration: 10 },
      { ...run }, { ...walk }, { ...run }, { ...walk }, { ...run }, { ...walk }, { ...run },
      { kind: 'recuperation', duration: 10 },
    ],
  };
}

export const isTest = (session) => Boolean(session?.test);
