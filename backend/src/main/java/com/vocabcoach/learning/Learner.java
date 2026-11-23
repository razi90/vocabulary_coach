package com.vocabcoach.learning;

/**
 * Whose learning state a query is about: a user in one course. A learner
 * doing Spanish and English has two separate sets of cards, events,
 * exercises and lessons. Every learner-owned query filters by both fields.
 */
public record Learner(long userId, Course course) {

  /** The course id as stored in the database. */
  public String courseId() {
    return course.id;
  }
}
