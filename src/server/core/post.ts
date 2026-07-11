import { reddit } from '@devvit/web/server';

export const createPost = async () => {
  return await reddit.submitCustomPost({
    title: 'The Vault: Getaway — daily heist runner',
  });
};
