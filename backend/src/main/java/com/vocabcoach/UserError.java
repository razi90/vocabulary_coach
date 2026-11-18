package com.vocabcoach;

/**
 * A mistake in what the learner or the coach sent - shown to them as is
 * (German), as a 400 in the API or as a tool error the model can correct.
 */
public class UserError extends RuntimeException {
  public UserError(String message) {
    super(message);
  }
}
